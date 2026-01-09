// backend/src/routes/admin/adminTenantsRouter.js
import express from "express";
import fetch from "node-fetch";
import { prisma } from "../../lib/prisma.js";
import logger from "../../logger.js";
import {
  asaasCreateCustomer,
  asaasCreateSubscription,
  asaasConfig
} from "../../services/asaasClient.js";

const router = express.Router();

// ===============================
// Helpers
// ===============================
function safeStr(v) {
  return String(v || "").trim();
}

function normalizeSlug(input) {
  return safeStr(input)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function normalizeCnpj(v) {
  return safeStr(v).replace(/\D+/g, "");
}

function asaasGroupDefaults() {
  return {
    asaasGroupName: "ClienteOnline - GP Labs",
    asaasCustomerAccountGroup: "305006"
  };
}

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    isActive: u.isActive,
    isSuperAdmin: u.isSuperAdmin === true,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt
  };
}

// ===============================
// App URL / Invite Link
// ===============================
function getAppWebUrl() {
  return (
    safeStr(process.env.APP_WEB_URL) ||
    safeStr(process.env.FRONTEND_URL) ||
    safeStr(process.env.PUBLIC_APP_URL) ||
    ""
  );
}

function getInvitePath() {
  // sua tela é CreatePasswordPage.jsx
  return safeStr(process.env.INVITE_PATH) || "/auth/create-password";
}

function buildInviteUrl(token) {
  const base = getAppWebUrl();
  const path = getInvitePath();
  if (!base) return "";
  const u = new URL(path, base);
  u.searchParams.set("token", String(token || ""));
  return u.toString();
}

// ===============================
// Resend (e-mail) — (mantido, mas hoje você disse que vai enviar no webhook)
// ===============================
async function sendResendEmailIfConfigured({ to, subject, html }) {
  const RESEND_API_KEY = safeStr(process.env.RESEND_API_KEY);
  const RESEND_FROM =
    safeStr(process.env.RESEND_FROM) ||
    safeStr(process.env.MAIL_FROM) ||
    safeStr(process.env.SMTP_FROM) ||
    "";

  if (!RESEND_API_KEY || !RESEND_FROM) {
    logger.warn(
      { RESEND_API_KEY: Boolean(RESEND_API_KEY), RESEND_FROM: Boolean(RESEND_FROM) },
      "resend: não configurado (pulando envio)"
    );
    return { sent: false, reason: "resend_not_configured" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html
      })
    });

    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!resp.ok) {
      logger.error({ status: resp.status, json }, "resend: falha ao enviar");
      return { sent: false, reason: "send_failed", status: resp.status, payload: json };
    }

    return { sent: true, id: json?.id || null };
  } catch (err) {
    logger.error({ err }, "resend: erro inesperado");
    return { sent: false, reason: "exception" };
  }
}

async function sendWelcomeInviteEmail({ to, tenantName, inviteUrl, expiresAt }) {
  const subject = "Pagamento recebido — Bem-vindo(a) à GP Labs 🎉";
  const exp = expiresAt ? new Date(expiresAt).toLocaleString("pt-BR") : "";

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.45">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:44px;height:44px;border-radius:12px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">GP</div>
      <div>
        <div style="font-size:16px;font-weight:800">GP Labs</div>
        <div style="font-size:12px;color:#475569">WhatsApp • Automação • Atendimento</div>
      </div>
    </div>

    <h2 style="margin:0 0 10px">Pagamento recebido ✅</h2>
    <p style="margin:0 0 8px">
      O pagamento da empresa <b>${String(tenantName || "sua empresa")}</b> foi confirmado.
    </p>
    <p style="margin:0 0 14px">
      Agora você já pode ativar seu acesso criando sua senha:
    </p>

    <p style="margin:16px 0">
      <a href="${inviteUrl}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">
        Criar senha e acessar
      </a>
    </p>

    <p style="margin:0 0 10px;color:#475569;font-size:12px">
      Se o botão não funcionar, copie e cole no navegador:<br/>
      <span style="word-break:break-all">${inviteUrl}</span>
    </p>

    ${exp ? `<p style="margin:10px 0 0;color:#475569;font-size:12px">Este link expira em: ${exp}</p>` : ""}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0"/>
    <p style="margin:0;color:#64748b;font-size:12px">
      Se você não esperava este e-mail, pode ignorar.
    </p>
  </div>
  `;

  return sendResendEmailIfConfigured({ to, subject, html });
}

// ===============================
// Pricing por valor fixo
// ===============================
function parseFixedValueFromPlanCode(planCodeRaw) {
  const s = safeStr(planCodeRaw);
  if (!s) return null;

  const normalized = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;

  const n = Number(normalized);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function getPlanPriceMap() {
  const raw = safeStr(process.env.BILLING_PLAN_PRICES);
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j === "object" ? j : null;
  } catch (err) {
    logger.warn({ err }, "BILLING_PLAN_PRICES inválido (JSON). Ignorando.");
    return null;
  }
}

function priceFor(planCode, cycle) {
  const code = safeStr(planCode || "starter") || "starter";
  const c = String(cycle || "MONTHLY").toUpperCase();

  const map = getPlanPriceMap();
  if (map?.[code]?.[c] != null) return Number(map[code][c]);

  const defaults = {
    free: { MONTHLY: 0, QUARTERLY: 0, YEARLY: 0 },
    starter: { MONTHLY: 99.9, QUARTERLY: 269.7, YEARLY: 999.0 },
    pro: { MONTHLY: 199.9, QUARTERLY: 539.7, YEARLY: 1990.0 }
  };

  const val = defaults?.[code]?.[c];
  return Number(val != null ? val : defaults.starter.MONTHLY);
}

function nextDueDateISO(daysFromNow = 1) {
  const d = addDays(daysFromNow);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

// ===============================
// Default group detection
// ===============================
async function hasDefaultGroup(tenantId) {
  const n = await prisma.group.count({
    where: { tenantId: String(tenantId), name: "Default" }
  });
  return n > 0;
}

// ===============================
// GET /admin/tenants
// ===============================
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
    const q = safeStr(req.query.q);

    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } }
          ]
        }
      : {};

    const [total, items] = await Promise.all([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { billing: true }
      })
    ]);

    res.json({ ok: true, page, pageSize, total, items });
  } catch (err) {
    logger.error({ err }, "admin.tenants.list error");
    res.status(500).json({ error: "Falha ao listar tenants" });
  }
});

// ===============================
// GET /admin/tenants/:id
// ===============================
router.get("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        companyProfile: true,
        billing: true
      }
    });

    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const members = await prisma.userTenant.findMany({
      where: { tenantId: id },
      orderBy: [{ createdAt: "asc" }],
      include: {
        user: { select: { id: true, email: true, name: true, isActive: true, isSuperAdmin: true } }
      }
    });

    const defaultGroupExists = await hasDefaultGroup(id);

    res.json({
      ok: true,
      tenant,
      companyProfile: tenant.companyProfile || null,
      billing: tenant.billing || null,
      members,
      hasDefaultGroup: defaultGroupExists
    });
  } catch (err) {
    logger.error({ err }, "admin.tenants.get error");
    res.status(500).json({ error: "Falha ao buscar tenant" });
  }
});

// ===============================
// POST /admin/tenants
// ===============================
router.post("/", async (req, res) => {
  try {
    const name = safeStr(req.body?.name);
    const slugRaw = safeStr(req.body?.slug);
    const adminEmail = safeStr(req.body?.adminEmail).toLowerCase();
    const adminName = safeStr(req.body?.adminName) || null;

    const inviteTtlDays = Math.min(30, Math.max(1, Number(req.body?.inviteTtlDays || 7)));

    const companyProfile = req.body?.companyProfile || null;
    const billing = req.body?.billing || null;

    const isActiveRequested =
      req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (!name) return res.status(400).json({ error: "name obrigatório" });
    if (!adminEmail || !adminEmail.includes("@")) {
      return res.status(400).json({ error: "adminEmail inválido" });
    }

    const slug = normalizeSlug(slugRaw || name);
    if (!slug) return res.status(400).json({ error: "slug inválido" });

    const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existingSlug) return res.status(409).json({ error: "slug já existe" });

    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, slug, isActive: isActiveRequested }
      });

      const user = await tx.user.upsert({
        where: { email: adminEmail },
        create: {
          email: adminEmail,
          name: adminName,
          role: "admin",
          isActive: true
        },
        update: {
          name: adminName || undefined,
          isActive: true
        }
      });

      const membership = await tx.userTenant.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        create: { userId: user.id, tenantId: tenant.id, role: "admin", isActive: true },
        update: { role: "admin", isActive: true }
      });

      let cp = null;
      if (companyProfile) {
        const cnpj = normalizeCnpj(companyProfile.cnpj);
        if (!companyProfile.legalName || !cnpj) {
          throw new Error("companyProfile inválido (legalName/cnpj)");
        }

        cp = await tx.tenantCompanyProfile.upsert({
          where: { tenantId: tenant.id },
          create: {
            tenantId: tenant.id,
            legalName: safeStr(companyProfile.legalName),
            tradeName: safeStr(companyProfile.tradeName) || null,
            cnpj,
            ie: safeStr(companyProfile.ie) || null,
            im: safeStr(companyProfile.im) || null,

            postalCode: safeStr(companyProfile.postalCode),
            address: safeStr(companyProfile.address),
            addressNumber: safeStr(companyProfile.addressNumber),
            complement: safeStr(companyProfile.complement) || null,
            province: safeStr(companyProfile.province) || null,
            city: safeStr(companyProfile.city) || null,
            state: safeStr(companyProfile.state) || null,
            country: safeStr(companyProfile.country) || "BR"
          },
          update: {
            legalName: safeStr(companyProfile.legalName),
            tradeName: safeStr(companyProfile.tradeName) || null,
            cnpj,
            ie: safeStr(companyProfile.ie) || null,
            im: safeStr(companyProfile.im) || null,

            postalCode: safeStr(companyProfile.postalCode),
            address: safeStr(companyProfile.address),
            addressNumber: safeStr(companyProfile.addressNumber),
            complement: safeStr(companyProfile.complement) || null,
            province: safeStr(companyProfile.province) || null,
            city: safeStr(companyProfile.city) || null,
            state: safeStr(companyProfile.state) || null,
            country: safeStr(companyProfile.country) || "BR"
          }
        });
      }

      const defaults = asaasGroupDefaults();

      const isFree = billing?.isFree !== undefined ? Boolean(billing.isFree) : true;
      const chargeEnabled = isFree === true ? false : Boolean(billing?.chargeEnabled === true);

      const trialEndsAt = isFree ? null : addDays(7);

      const accessStatus = isFree ? "ACTIVE" : "BLOCKED";

      const b = await tx.tenantBilling.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          provider: "asaas",
          status: "NOT_CONFIGURED",

          planCode: safeStr(billing?.planCode) || (isFree ? "free" : "starter"),
          pricingRef: safeStr(billing?.pricingRef) || null,

          isFree,
          chargeEnabled,

          billingCycle: billing?.billingCycle ? String(billing.billingCycle) : "MONTHLY",
          preferredMethod: billing?.preferredMethod ? String(billing.preferredMethod) : "UNDEFINED",

          billingEmail: safeStr(billing?.billingEmail) || null,

          asaasGroupName: safeStr(billing?.asaasGroupName) || defaults.asaasGroupName,
          asaasCustomerAccountGroup:
            safeStr(billing?.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup,

          trialEndsAt,
          accessStatus,

          blockedAt: isFree ? null : now,
          blockedReason: isFree ? null : "awaiting_first_payment",

          graceDaysAfterDue:
            billing?.graceDaysAfterDue != null
              ? Math.max(1, Number(billing.graceDaysAfterDue))
              : undefined
        },
        update: {}
      });

      const expiresAt = addDays(inviteTtlDays);
      const passwordToken = await tx.passwordToken.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          type: "invite",
          expiresAt,
          used: false
        }
      });

      return { tenant, user, membership, companyProfile: cp, billing: b, passwordToken };
    });

    // ASAAS create (fora tx)
    let asaas = { ok: false, reason: null };

    if (result.billing?.isFree === true) {
      asaas = { ok: true, skipped: true, reason: "free_plan" };
    } else {
      try {
        const cp = await prisma.tenantCompanyProfile.findUnique({
          where: { tenantId: result.tenant.id }
        });

        if (!cp?.cnpj || !cp?.legalName) {
          await prisma.tenantBilling.update({
            where: { tenantId: result.tenant.id },
            data: {
              status: "ERROR",
              lastError: "company_profile_missing_for_asaas",
              lastSyncAt: new Date()
            }
          });

          asaas = { ok: false, reason: "company_profile_missing" };
        } else {
          const customer = await asaasCreateCustomer({
            name: cp.legalName,
            cpfCnpj: cp.cnpj,
            email: result.billing?.billingEmail || result.user.email || undefined,
            postalCode: cp.postalCode || undefined,
            address: cp.address || undefined,
            addressNumber: cp.addressNumber || undefined,
            complement: cp.complement || undefined,
            province: cp.province || undefined,
            city: cp.city || undefined,
            state: cp.state || undefined
          });

          const cycle = String(result.billing?.billingCycle || "MONTHLY").toUpperCase();

          const fixedValue = parseFixedValueFromPlanCode(result.billing?.planCode);
          const planCode = fixedValue ? "custom" : (result.billing?.planCode || "starter");
          const value = fixedValue != null ? fixedValue : priceFor(planCode, cycle);

          const subscription = await asaasCreateSubscription({
            customer: customer.id,
            billingType: "UNDEFINED",
            cycle,
            value,
            nextDueDate: nextDueDateISO(1),
            description: `Assinatura GP Labs (${planCode})`,
            externalReference: `tenant:${result.tenant.id}`
          });

          await prisma.tenantBilling.update({
            where: { tenantId: result.tenant.id },
            data: {
              status: "SYNCED",
              asaasCustomerId: customer.id,
              asaasSubscriptionId: subscription.id,
              lastError: null,
              lastSyncAt: new Date()
            }
          });

          asaas = {
            ok: true,
            env: asaasConfig?.env,
            customerId: customer.id,
            subscriptionId: subscription.id,
            value
          };
        }
      } catch (err) {
        logger.error({ err }, "asaas: falha ao criar customer/subscription");

        await prisma.tenantBilling.update({
          where: { tenantId: result.tenant.id },
          data: {
            status: "ERROR",
            lastError: "asaas_create_failed",
            lastSyncAt: new Date()
          }
        });

        asaas = {
          ok: false,
          reason: "asaas_create_failed",
          message: String(err?.message || "")
        };
      }
    }

    res.status(201).json({
      ok: true,
      tenant: result.tenant,
      adminUser: sanitizeUser(result.user),
      membership: result.membership,
      companyProfile: result.companyProfile,
      billing: await prisma.tenantBilling.findUnique({ where: { tenantId: result.tenant.id } }),
      invite: {
        token: result.passwordToken.token,
        expiresAt: result.passwordToken.expiresAt,
        url: buildInviteUrl(result.passwordToken.token) || null
      },
      inviteEmail: { sent: false, reason: "sent_on_payment_webhook" },
      asaas
    });
  } catch (err) {
    const msg = String(err?.message || "");
    logger.error({ err, msg }, "admin.tenants.create error");

    if (msg.includes("companyProfile inválido")) {
      return res.status(400).json({ error: msg });
    }
    if (msg.includes("unique") || msg.includes("Unique constraint")) {
      return res.status(409).json({ error: "Conflito de dados (unique)" });
    }
    return res.status(500).json({ error: "Falha ao criar tenant" });
  }
});

// ===============================
// PATCH /admin/tenants/:id
// - agora atualiza tenant + companyProfile (se enviado)
// ===============================
router.patch("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const name = req.body?.name != null ? safeStr(req.body.name) : undefined;
    const slug = req.body?.slug != null ? normalizeSlug(req.body.slug) : undefined;
    const isActive = req.body?.isActive;

    const companyProfile = req.body?.companyProfile;

    const data = {};
    if (name !== undefined) {
      if (!name) return res.status(400).json({ error: "name inválido" });
      data.name = name;
    }
    if (slug !== undefined) {
      if (!slug) return res.status(400).json({ error: "slug inválido" });
      const existing = await prisma.tenant.findUnique({ where: { slug } });
      if (existing && existing.id !== id) return res.status(409).json({ error: "slug já existe" });
      data.slug = slug;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const result = await prisma.$transaction(async (tx) => {
      const updatedTenant = await tx.tenant.update({ where: { id }, data });

      let updatedCp = null;

      if (companyProfile && typeof companyProfile === "object") {
        const patch = {};

        if (companyProfile.legalName !== undefined) patch.legalName = safeStr(companyProfile.legalName);
        if (companyProfile.tradeName !== undefined) patch.tradeName = safeStr(companyProfile.tradeName) || null;
        if (companyProfile.cnpj !== undefined) patch.cnpj = normalizeCnpj(companyProfile.cnpj) || "";
        if (companyProfile.ie !== undefined) patch.ie = safeStr(companyProfile.ie) || null;
        if (companyProfile.im !== undefined) patch.im = safeStr(companyProfile.im) || null;

        if (companyProfile.postalCode !== undefined) patch.postalCode = safeStr(companyProfile.postalCode) || "";
        if (companyProfile.address !== undefined) patch.address = safeStr(companyProfile.address) || "";
        if (companyProfile.addressNumber !== undefined) patch.addressNumber = safeStr(companyProfile.addressNumber) || "";
        if (companyProfile.complement !== undefined) patch.complement = safeStr(companyProfile.complement) || null;
        if (companyProfile.province !== undefined) patch.province = safeStr(companyProfile.province) || null;
        if (companyProfile.city !== undefined) patch.city = safeStr(companyProfile.city) || null;
        if (companyProfile.state !== undefined) patch.state = safeStr(companyProfile.state) || null;
        if (companyProfile.country !== undefined) patch.country = safeStr(companyProfile.country) || "BR";

        if (Object.keys(patch).length > 0) {
          const exists = await tx.tenantCompanyProfile.findUnique({ where: { tenantId: id } });

          if (!exists) {
            updatedCp = await tx.tenantCompanyProfile.create({
              data: {
                tenantId: id,
                legalName: patch.legalName || "",
                cnpj: patch.cnpj || "",
                postalCode: patch.postalCode || "",
                address: patch.address || "",
                addressNumber: patch.addressNumber || "",
                tradeName: patch.tradeName ?? null,
                ie: patch.ie ?? null,
                im: patch.im ?? null,
                complement: patch.complement ?? null,
                province: patch.province ?? null,
                city: patch.city ?? null,
                state: patch.state ?? null,
                country: patch.country || "BR"
              }
            });
          } else {
            updatedCp = await tx.tenantCompanyProfile.update({
              where: { tenantId: id },
              data: patch
            });
          }
        }
      }

      return { tenant: updatedTenant, companyProfile: updatedCp };
    });

    res.json({ ok: true, tenant: result.tenant, companyProfile: result.companyProfile });
  } catch (err) {
    logger.error({ err }, "admin.tenants.patch error");
    res.status(500).json({ error: "Falha ao atualizar tenant" });
  }
});

// ===============================
// PATCH /admin/tenants/:id/billing
// ===============================
router.patch("/:id/billing", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);
    const defaults = asaasGroupDefaults();

    const planCode = req.body?.planCode !== undefined ? safeStr(req.body.planCode) || null : undefined;
    const pricingRef = req.body?.pricingRef !== undefined ? safeStr(req.body.pricingRef) || null : undefined;

    const isFree = req.body?.isFree !== undefined ? Boolean(req.body.isFree) : undefined;
    const chargeEnabledRaw =
      req.body?.chargeEnabled !== undefined ? Boolean(req.body.chargeEnabled) : undefined;

    const billingCycle =
      req.body?.billingCycle !== undefined ? String(req.body.billingCycle) : undefined;

    const preferredMethod =
      req.body?.preferredMethod !== undefined ? String(req.body.preferredMethod) : undefined;

    const billingEmail =
      req.body?.billingEmail !== undefined ? safeStr(req.body.billingEmail) || null : undefined;

    const graceDaysAfterDue =
      req.body?.graceDaysAfterDue !== undefined
        ? Math.max(1, Number(req.body.graceDaysAfterDue))
        : undefined;

    const asaasGroupName =
      req.body?.asaasGroupName !== undefined
        ? safeStr(req.body.asaasGroupName) || defaults.asaasGroupName
        : undefined;

    const asaasCustomerAccountGroup =
      req.body?.asaasCustomerAccountGroup !== undefined
        ? safeStr(req.body.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup
        : undefined;

    const current = await prisma.tenantBilling.findUnique({ where: { tenantId } });
    if (!current) {
      return res.status(404).json({ error: "Billing não encontrado (tenantBilling missing)" });
    }

    const finalIsFree = isFree !== undefined ? isFree : current.isFree;
    const finalChargeEnabled =
      finalIsFree === true
        ? false
        : chargeEnabledRaw !== undefined
          ? chargeEnabledRaw
          : current.chargeEnabled;

    const updated = await prisma.tenantBilling.update({
      where: { tenantId },
      data: {
        planCode,
        pricingRef,
        isFree: isFree !== undefined ? finalIsFree : undefined,
        chargeEnabled: finalChargeEnabled,
        billingCycle,
        preferredMethod,
        billingEmail,
        graceDaysAfterDue,
        asaasGroupName,
        asaasCustomerAccountGroup
      }
    });

    res.json({ ok: true, billing: updated });
  } catch (err) {
    logger.error({ err }, "admin.tenants.billing.patch error");
    res.status(500).json({ error: "Falha ao atualizar billing" });
  }
});

// ===============================
// POST /admin/tenants/:id/billing/sync
// - cria customer + subscription no Asaas para tenant existente
// ===============================
router.post("/:id/billing/sync", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { companyProfile: true, billing: true }
    });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const b = tenant.billing;
    if (!b) return res.status(404).json({ error: "Billing não encontrado (tenantBilling missing)" });

    if (b.isFree === true) {
      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: { status: "SYNCED", lastError: null, lastSyncAt: new Date() }
      });
      return res.json({ ok: true, skipped: true, reason: "free_plan", billing: updated });
    }

    const cp = tenant.companyProfile;
    if (!cp?.cnpj || !cp?.legalName) {
      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: { status: "ERROR", lastError: "company_profile_missing_for_asaas", lastSyncAt: new Date() }
      });
      return res.status(400).json({ error: "company_profile_missing_for_asaas", billing: updated });
    }

    if (b.asaasCustomerId && b.asaasSubscriptionId) {
      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: { status: "SYNCED", lastError: null, lastSyncAt: new Date() }
      });
      return res.json({ ok: true, alreadySynced: true, billing: updated });
    }

    try {
      const customer = await asaasCreateCustomer({
        name: cp.legalName,
        cpfCnpj: cp.cnpj,
        email: b.billingEmail || undefined,
        postalCode: cp.postalCode || undefined,
        address: cp.address || undefined,
        addressNumber: cp.addressNumber || undefined,
        complement: cp.complement || undefined,
        province: cp.province || undefined,
        city: cp.city || undefined,
        state: cp.state || undefined
      });

      const cycle = String(b.billingCycle || "MONTHLY").toUpperCase();

      const fixedValue = parseFixedValueFromPlanCode(b.planCode);
      const planCode = fixedValue ? "custom" : (b.planCode || "starter");
      const value = fixedValue != null ? fixedValue : priceFor(planCode, cycle);

      const subscription = await asaasCreateSubscription({
        customer: customer.id,
        billingType: "UNDEFINED",
        cycle,
        value,
        nextDueDate: nextDueDateISO(1),
        description: `Assinatura GP Labs (${planCode})`,
        externalReference: `tenant:${tenantId}`
      });

      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          status: "SYNCED",
          asaasCustomerId: customer.id,
          asaasSubscriptionId: subscription.id,
          lastError: null,
          lastSyncAt: new Date()
        }
      });

      return res.json({
        ok: true,
        billing: updated,
        asaas: {
          env: asaasConfig?.env,
          customerId: customer.id,
          subscriptionId: subscription.id,
          value
        }
      });
    } catch (err2) {
      logger.error({ err: err2 }, "admin.tenants.billing.sync error (asaas)");

      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: { status: "ERROR", lastError: "asaas_create_failed", lastSyncAt: new Date() }
      });

      return res.status(500).json({
        error: "asaas_create_failed",
        message: String(err2?.message || ""),
        billing: updated
      });
    }
  } catch (err) {
    logger.error({ err }, "admin.tenants.billing.sync error");
    return res.status(500).json({ error: "Falha ao sincronizar billing" });
  }
});

// ===============================
// POST /admin/tenants/:id/bootstrap
// ===============================
router.post("/:id/bootstrap", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);
    const addAdminsToGroup = Boolean(req.body?.addAdminsToGroup !== false);

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const already = await hasDefaultGroup(tenantId);
    if (already) {
      return res.json({
        ok: true,
        tenantId,
        alreadyBootstrapped: true,
        note: "Grupo Default já existe. Bootstrap não necessário."
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const defaultGroupName = "Default";
      const group = await tx.group.create({
        data: {
          tenantId,
          name: defaultGroupName,
          isActive: true,
          maxChatsPerAgent: 3
        }
      });

      let added = 0;

      if (addAdminsToGroup) {
        const admins = await tx.userTenant.findMany({
          where: { tenantId, isActive: true, role: "admin" }
        });

        for (const m of admins) {
          await tx.groupMember.upsert({
            where: { tenantId_groupId_userId: { tenantId, groupId: group.id, userId: m.userId } },
            create: {
              tenantId,
              groupId: group.id,
              userId: m.userId,
              role: "member",
              isActive: true
            },
            update: { isActive: true }
          });
          added += 1;
        }
      }

      return { group, addedAdmins: added };
    });

    res.json({ ok: true, tenantId, bootstrap: result, alreadyBootstrapped: false });
  } catch (err) {
    logger.error({ err }, "admin.tenants.bootstrap error");
    res.status(500).json({ error: "Falha no bootstrap" });
  }
});

// ===============================
// DELETE /admin/tenants/:id
// ===============================
router.delete("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const exists = await prisma.tenant.findUnique({ where: { id } });
    if (!exists) return res.status(404).json({ error: "Tenant não encontrado" });

    await prisma.tenant.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "admin.tenants.delete error");
    return res.status(500).json({ error: "Falha ao deletar tenant" });
  }
});

export default router;
