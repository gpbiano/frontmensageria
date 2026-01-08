// backend/src/routes/billing/billingRouter.js
import express from "express";
import fetch from "node-fetch";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

// ✅ (opcional) mesma mensagem padrão usada no login / enforceBillingAccess
import { BILLING_BLOCK_MESSAGE } from "../../middleware/enforceBillingAccess.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

// ======================================================
// Helpers
// ======================================================
function safeStr(v) {
  return String(v || "").trim();
}

function requireEnv(name) {
  const v = safeStr(process.env[name]);
  if (!v) throw new Error(`${name} não definido no ambiente`);
  return v;
}

function getAsaasBaseUrl() {
  // prod:    https://api.asaas.com/v3
  // sandbox: https://api-sandbox.asaas.com/v3
  return safeStr(process.env.ASAAS_BASE_URL) || "https://api.asaas.com/v3";
}

function getAsaasApiKey() {
  return requireEnv("ASAAS_API_KEY");
}

function asaasHeaders() {
  return {
    "Content-Type": "application/json",
    access_token: getAsaasApiKey()
  };
}

function normalizeDigitsOnly(v) {
  return safeStr(v).replace(/\D+/g, "");
}

function normalizeCycle(input) {
  const v = safeStr(input).toUpperCase();
  if (v === "MONTHLY" || v === "QUARTERLY" || v === "YEARLY") return v;
  // compat PT
  if (v === "MENSAL") return "MONTHLY";
  if (v === "TRIMESTRAL") return "QUARTERLY";
  if (v === "ANUAL") return "YEARLY";
  return "";
}

function normalizeBillingType(input) {
  const v = safeStr(input).toUpperCase();
  // BillingMethod no schema: UNDEFINED | BOLETO | PIX | CREDIT_CARD
  if (!v) return "UNDEFINED";
  if (v === "UNDEFINED" || v === "BOLETO" || v === "PIX" || v === "CREDIT_CARD") return v;
  // compat
  if (v === "CARTAO" || v === "CARTAO_CREDITO" || v === "CREDITCARD") return "CREDIT_CARD";
  return "UNDEFINED";
}

function toNumberOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (Number.isNaN(n)) return null;
  return n;
}

async function asaasRequest(method, path, body) {
  const url = `${getAsaasBaseUrl()}${path}`;
  const opts = { method, headers: asaasHeaders() };
  if (body) opts.body = JSON.stringify(body);

  const resp = await fetch(url, opts);
  const text = await resp.text();

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!resp.ok) {
    const err = new Error(`Asaas ${method} ${path} failed: ${resp.status}`);
    err.status = resp.status;
    err.payload = json || text;
    throw err;
  }

  return json;
}

function removeUndefined(obj) {
  Object.keys(obj).forEach((k) => obj[k] === undefined && delete obj[k]);
  return obj;
}

function asaasGroupDefaults() {
  return {
    asaasGroupName: "ClienteOnline - GP Labs",
    asaasCustomerAccountGroup: "305006"
  };
}

// ======================================================
// GET /billing/me
// Snapshot do billing atual do tenant (pra UI)
// ======================================================
router.get("/me", async (req, res) => {
  try {
    const tenantId = safeStr(req?.tenant?.id || req?.user?.tenantId);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { billing: true }
    });

    if (!tenant) return res.status(404).json({ error: "tenant_not_found" });

    return res.json({
      ok: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, isActive: tenant.isActive },
      billing: tenant.billing || null
    });
  } catch (err) {
    logger.error({ err }, "❌ /billing/me error");
    return res.status(500).json({ error: "internal_server_error" });
  }
});

// ======================================================
// POST /billing/pay
// Gera link de pagamento no Asaas para o cliente finalizar sozinho.
//
// Body esperado (mínimo):
// {
//   "cycle": "MONTHLY" | "QUARTERLY" | "YEARLY",
//   "value": 199.9,                      // (por enquanto obrigatório, até você plugar tabela de preços)
//   "planCode": "starter" | "pro" | ...  // opcional
//   "description": "Plano Pro - GP Labs",// opcional
//   "billingType": "UNDEFINED" | "BOLETO" | "PIX" | "CREDIT_CARD" (opcional)
//   "dueDateLimitDays": 3                // opcional (para boleto)
// }
//
// Regras do seu projeto:
// - Cliente escolhe ciclo (mensal/trimestral/anual)
// - Checkout/pagamento é concluído no Asaas (link)
// - Trial 7 dias: a cobrança deve iniciar após o trial (você controla isso no fluxo de assinatura/webhook)
// - Conta bloqueada (inadimplência/política): ao tentar logar deve ver a mensagem padrão.
//   *IMPORTANTE*: este endpoint deve continuar acessível para permitir pagamento (ideal liberar no middleware).
// ======================================================
router.post("/pay", async (req, res) => {
  try {
    const tenantId = safeStr(req?.tenant?.id || req?.user?.tenantId);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { companyProfile: true, billing: true }
    });

    if (!tenant) return res.status(404).json({ error: "tenant_not_found" });
    if (tenant.isActive === false) return res.status(403).json({ error: "tenant_inactive" });

    const defaults = asaasGroupDefaults();

    const cycle = normalizeCycle(req.body?.cycle);
    const planCode = safeStr(req.body?.planCode) || null;

    const value = toNumberOrNull(req.body?.value);
    const description =
      safeStr(req.body?.description) || `Assinatura GP Labs - ${tenant.name}`;

    // "UNDEFINED" -> deixa o checkout escolher (quando a conta permitir)
    const billingType = normalizeBillingType(req.body?.billingType);

    const dueDateLimitDays =
      req.body?.dueDateLimitDays != null ? Number(req.body?.dueDateLimitDays) : null;

    // ✅ Garante billing row
    const billing = await prisma.tenantBilling.upsert({
      where: { tenantId: tenant.id },
      create: {
        tenantId: tenant.id,
        provider: "asaas",

        // grupos default
        asaasGroupName: defaults.asaasGroupName,
        asaasCustomerAccountGroup: defaults.asaasCustomerAccountGroup,

        // defaults do seu modelo
        status: "PENDING_SYNC",
        planCode: planCode || "free",
        isFree: true,
        chargeEnabled: false,

        billingCycle: cycle || "MONTHLY",
        preferredMethod: billingType || "UNDEFINED",

        accessStatus: "TRIALING"
      },
      update: {
        asaasGroupName: tenant.billing?.asaasGroupName || defaults.asaasGroupName,
        asaasCustomerAccountGroup:
          tenant.billing?.asaasCustomerAccountGroup || defaults.asaasCustomerAccountGroup
      }
    });

    // ✅ Se ainda é free, não gera cobrança (política atual)
    // (você pode remover isso quando decidir que todo mundo deve pagar após trial)
    if (billing.isFree === true || String(billing.planCode || "").toLowerCase() === "free") {
      return res.json({
        ok: true,
        free: true,
        message: "Tenant está em plano free. Não gera link de pagamento.",
        billing: {
          tenantId: billing.tenantId,
          planCode: billing.planCode,
          isFree: billing.isFree,
          chargeEnabled: billing.chargeEnabled,
          accessStatus: billing.accessStatus
        }
      });
    }

    if (!cycle) {
      return res.status(400).json({
        error: "invalid_cycle",
        detail: "Informe cycle: MONTHLY | QUARTERLY | YEARLY"
      });
    }

    // Por enquanto, value é necessário para gerar link.
    // Quando você plugar sua tabela de preços: derive o value por (planCode + cycle) e remove do body.
    if (value == null || value <= 0) {
      await prisma.tenantBilling.update({
        where: { tenantId: tenant.id },
        data: {
          lastError: "pricing_missing_for_checkout",
          status: "PENDING_SYNC",
          lastSyncAt: new Date()
        }
      });

      return res.status(400).json({
        error: "pricing_missing",
        detail: "Defina um value (preço) para gerar o link de pagamento."
      });
    }

    // ======================================================
    // 1) Cria/Garante CUSTOMER no Asaas (sempre no grupo)
    // ======================================================
    const company = tenant.companyProfile;

    // mínimo (asaas): name e email (cpfCnpj recomendado)
    const customerPayload = removeUndefined({
      name: safeStr(company?.legalName) || safeStr(company?.tradeName) || safeStr(tenant.name),
      // tenta pegar billingEmail, depois user logado (se existir), senão deixa o Asaas validar
      email: safeStr(billing.billingEmail) || safeStr(req?.user?.email) || undefined,
      cpfCnpj: company?.cnpj ? normalizeDigitsOnly(company.cnpj) : undefined,

      postalCode: safeStr(company?.postalCode) || undefined,
      address: safeStr(company?.address) || undefined,
      addressNumber: safeStr(company?.addressNumber) || undefined,
      complement: safeStr(company?.complement) || undefined,
      province: safeStr(company?.province) || undefined,
      city: safeStr(company?.city) || undefined,
      state: safeStr(company?.state) || undefined,
      country: safeStr(company?.country) || "BR",

      // segmentação
      customerAccountGroup: safeStr(billing.asaasCustomerAccountGroup || defaults.asaasCustomerAccountGroup) || undefined
    });

    let asaasCustomerId = safeStr(billing.asaasCustomerId);

    if (!asaasCustomerId) {
      const createdCustomer = await asaasRequest("POST", "/customers", customerPayload);
      asaasCustomerId = safeStr(createdCustomer?.id);

      await prisma.tenantBilling.update({
        where: { tenantId: tenant.id },
        data: {
          asaasCustomerId,
          lastError: null,
          status: "PENDING_SYNC",
          lastSyncAt: new Date()
        }
      });
    } else {
      // update best-effort (sem quebrar checkout)
      try {
        // alguns ambientes aceitam PUT; outros aceitam POST. Tentamos ambos.
        try {
          await asaasRequest("PUT", `/customers/${asaasCustomerId}`, customerPayload);
        } catch {
          await asaasRequest("POST", `/customers/${asaasCustomerId}`, customerPayload);
        }
      } catch (e) {
        logger.warn({ e }, "⚠️ Asaas customer update falhou (seguindo mesmo assim)");
      }
    }

    // ======================================================
    // 2) Gera LINK DE PAGAMENTO (ASSINATURA) pro checkout
    // ======================================================
    // ✅ Opção A (mais simples agora): Payment Link (SUBSCRIPTION)
    // - Cliente finaliza no Asaas
    // - Você recebe webhooks e muda accessStatus (ACTIVE / PAST_DUE / BLOCKED)
    const paymentLinkPayload = removeUndefined({
      name: description,
      description,
      value,

      // assinatura
      chargeType: "SUBSCRIPTION",
      subscriptionCycle: cycle,

      // deixa o checkout escolher quando possível
      billingType: billingType || "UNDEFINED",

      ...(dueDateLimitDays ? { dueDateLimitDays } : {}),

      // rastreio interno (útil no webhook)
      externalReference: `tenant:${tenant.id};plan:${planCode || billing.planCode || ""};cycle:${cycle}`

      // (quando você quiser) callback/redirect do checkout:
      // callback: "https://.../billing/asaas/callback"
    });

    const paymentLink = await asaasRequest("POST", "/paymentLinks", paymentLinkPayload);

    const url = safeStr(paymentLink?.url || paymentLink?.link) || null;
    const paymentLinkId = safeStr(paymentLink?.id) || null;

    // ======================================================
    // 3) Espelha estado no billing (pra UI)
    // ======================================================
    // Trial: cobrança deve iniciar depois de trialEndsAt.
    // Aqui a gente só prepara os metadados/links.
    const trialEndsAt = billing.trialEndsAt ? new Date(billing.trialEndsAt) : null;

    await prisma.tenantBilling.update({
      where: { tenantId: tenant.id },
      data: {
        status: "PENDING_SYNC",

        // registra preferência e ciclo
        billingCycle: cycle,
        preferredMethod: billingType,

        // registra “intenção de compra”
        planCode: planCode || billing.planCode,
        isFree: false,
        // chargeEnabled pode ficar false até você confirmar que quer cobrar (ou ativar já)
        // aqui vou ligar, pois você quer que cliente finalize no Asaas
        chargeEnabled: true,

        // links pro front
        lastPaymentStatus: "PENDING",
        lastPaymentId: paymentLinkId,
        lastInvoiceUrl: url,

        // próxima cobrança esperada (trial -> depois do trial; senão -> agora)
        nextChargeDueDate: trialEndsAt && trialEndsAt.getTime() > Date.now() ? trialEndsAt : undefined,

        lastError: null,
        lastSyncAt: new Date()
      }
    });

    return res.json({
      ok: true,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
      billing: {
        planCode: planCode || billing.planCode,
        cycle,
        value,
        trialEndsAt: billing.trialEndsAt || null
      },
      asaas: {
        customerId: asaasCustomerId,
        paymentLinkId,
        url
      },
      // se o tenant estiver bloqueado no sistema, essa é a mensagem oficial
      blockedMessage: BILLING_BLOCK_MESSAGE
    });
  } catch (err) {
    logger.error({ err, payload: err?.payload }, "❌ /billing/pay error");

    const status = Number(err?.status) || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      error: "billing_pay_failed",
      detail: String(err?.message || "Falha ao gerar link de pagamento.")
    });
  }
});

export default router;
