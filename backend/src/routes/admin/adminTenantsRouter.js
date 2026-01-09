// backend/src/routes/admin/tenantsAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";
import logger from "../../logger.js";
import { asaasCreateCustomer, asaasCreateSubscription, asaasConfig } from "../../services/asaasClient.js";
import { sendEmailResend } from "../../services/mailer.js";

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

function getAppWebUrl() {
  return (
    safeStr(process.env.APP_WEB_URL) ||
    safeStr(process.env.FRONTEND_URL) ||
    safeStr(process.env.PUBLIC_APP_URL) ||
    ""
  );
}

function getInvitePath() {
  // ✅ ajuste p/ sua rota real do CreatePasswordPage
  // ex: "/auth/create-password"
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

async function hasDefaultGroup(tenantId) {
  const n = await prisma.group.count({
    where: { tenantId: String(tenantId), name: "Default" }
  });
  return n > 0;
}

function cycleToAsaasCycle(cycle) {
  const c = String(cycle || "MONTHLY").toUpperCase();
  if (c === "MONTHLY") return "MONTHLY";
  if (c === "QUARTERLY") return "QUARTERLY";
  if (c === "YEARLY") return "YEARLY";
  return "MONTHLY";
}

function preferredToBillingType(preferredMethod) {
  const m = String(preferredMethod || "UNDEFINED").toUpperCase();
  if (m === "BOLETO") return "BOLETO";
  if (m === "PIX") return "PIX";
  if (m === "CREDIT_CARD") return "CREDIT_CARD";
  return "UNDEFINED";
}

function todayPlus(days) {
  const d = addDays(days);
  // yyyy-mm-dd
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
// ✅ cria tenant + billing + token
// ✅ se NÃO for free: cria customer+subscription no Asaas e bloqueia acesso até pagar
// ✅ se for free: manda invite email já
// ===============================
router.post("/", async (req, res) => {
  try {
    const name = safeStr(req.body?.name);
    const slugRaw = safeStr(req.body?.slug);
    const adminEmail = safeStr(req.body?.adminEmail).toLowerCase();
    const adminName = safeStr(req.body?.adminName) || null;

    const sendInvite = req.body?.sendInvite !== false;
    const inviteTtlDays = Math.min(30, Math.max(1, Number(req.body?.inviteTtlDays || 7)));

    const companyProfile = req.body?.companyProfile || null;
    const billing = req.body?.billing || null;

    const isActiveRequested = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;

    if (!name) return res.status(400).json({ error: "name obrigatório" });
    if (!adminEmail || !adminEmail.includes("@")) {
      return res.status(400).json({ error: "adminEmail inválido" });
    }

    const slug = normalizeSlug(slugRaw || name);
    if (!slug) return res.status(400).json({ error: "slug inválido" });

    const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existingSlug) return res.status(409).json({ error: "slug já existe" });

    const defaults = asaasGroupDefaults();

    // regra: free default
    const isFree = billing?.isFree !== undefined ? Boolean(billing.isFree) : true;

    // regra: free => chargeEnabled false sempre
    const chargeEnabled = isFree === true ? false : Boolean(billing?.chargeEnabled === true);

    // ✅ NOVA REGRA: paid => só acessa depois pagar
    // free => ACTIVE
    // paid => PENDING_PAYMENT
    const accessStatus = isFree ? "ACTIVE" : "PENDING_PAYMENT";

    const result = await prisma.$transaction(async (tx) => {
      // 1) tenant
      const tenant = await tx.tenant.create({
        data: { name, slug, isActive: isActiveRequested }
      });

      // 2) user global
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

      // 3) membership
      const membership = await tx.userTenant.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        create: { userId: user.id, tenantId: tenant.id, role: "admin", isActive: true },
        update: { role: "admin", isActive: true }
      });

      // 4) companyProfile (opcional)
      let cp = null;
      if (companyProfile) {
        const cnpj = normalizeCnpj(companyProfile.cnpj);
        if (!companyProfile.legalName || !cnpj) {
          const e = new Error("companyProfile inválido (legalName/cnpj)");
          e.code = "COMPANY_INVALID";
          throw e;
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

      // 5) billing (cria sempre)
      const b = await tx.tenantBilling.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          provider: "asaas",

          // status interno da integração
          status: isFree ? "SYNCED" : "PENDING_SYNC",

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

          // ✅ regra nova (acesso)
          accessStatus,

          graceDaysAfterDue:
            billing?.graceDaysAfterDue != null
              ? Math.max(1, Number(billing.graceDaysAfterDue))
              : undefined
        },
        update: {}
      });

      // 6) token de invite (sempre cria, mas e-mail pode ser só após pagamento)
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

    // ✅ se paid: cria customer/subscription no Asaas (fora da transação)
    let asaas = { ok: false, reason: "skipped" };
    if (!isFree) {
      const cp = result.companyProfile;

      // pra criar cliente no Asaas, precisamos de legalName + cnpj
      if (!cp?.legalName || !cp?.cnpj) {
        asaas = {
          ok: false,
          reason: "company_profile_missing",
          note: "Para criar assinatura no Asaas, preencha Razão Social + CNPJ no Perfil da Empresa."
        };

        // mantém bloqueado
        await prisma.tenantBilling.update({
          where: { tenantId: result.tenant.id },
          data: { status: "ERROR", lastError: "company_profile_missing" }
        });
      } else {
        try {
          // 1) cria customer
          const customer = await asaasCreateCustomer({
            name: cp.tradeName || cp.legalName,
            cpfCnpj: cp.cnpj,
            email: adminEmail,
            postalCode: cp.postalCode,
            address: cp.address,
            addressNumber: cp.addressNumber,
            complement: cp.complement,
            province: cp.province,
            city: cp.city,
            state: cp.state
          });

          // 2) cria subscription (mensal/trimestral/anual)
          // ⚠️ valor: como você não mandou tabela de preço aqui, vou usar:
          // - se billing.pricingRef vier numérico, usamos como value
          // - senão, value = 0 e você ajusta (ou mapeia planCode->value)
          const rawValue = Number(String(result.billing?.pricingRef || "").replace(",", "."));
          const value = Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 0;

          const sub = await asaasCreateSubscription({
            customer: customer.id,
            billingType: preferredToBillingType(result.billing?.preferredMethod),
            cycle: cycleToAsaasCycle(result.billing?.billingCycle),
            value,
            nextDueDate: todayPlus(1),
            description: `Assinatura ${result.billing?.planCode || "plano"} - ${result.tenant.name}`,
            externalReference: `tenant:${result.tenant.id}`
          });

          await prisma.tenantBilling.update({
            where: { tenantId: result.tenant.id },
            data: {
              asaasCustomerId: customer.id,
              asaasSubscriptionId: sub.id,
              status: "PENDING_PAYMENT",
              lastError: null,
              lastSyncAt: new Date()
            }
          });

          asaas = {
            ok: true,
            env: asaasConfig.env,
            customerId: customer.id,
            subscriptionId: sub.id,
            note:
              value > 0
                ? "Assinatura criada. A primeira cobrança será gerada pelo Asaas."
                : "Assinatura criada com value=0. Ajuste o mapeamento de preço (pricingRef/planCode) para gerar cobrança."
          };
        } catch (err) {
          logger.error({ err }, "asaas: falha ao criar customer/subscription");
          await prisma.tenantBilling.update({
            where: { tenantId: result.tenant.id },
            data: { status: "ERROR", lastError: "asaas_create_failed" }
          });

          asaas = { ok: false, reason: "asaas_create_failed" };
        }
      }
    }

    // ✅ convite por e-mail:
    // - free: envia agora
    // - paid: RECOMENDO enviar só após PAYMENT_RECEIVED (webhook) pra cumprir a regra.
    let inviteEmail = { sent: false, reason: "not_sent" };
    if (sendInvite && isFree) {
      const inviteUrl = buildInviteUrl(result.passwordToken.token);
      inviteEmail = await sendEmailResend({
        to: adminEmail,
        subject: "Bem-vindo ao GP Labs — Crie sua senha",
        html: `
          <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.4">
            <h2 style="margin:0 0 12px">Bem-vindo ao GP Labs</h2>
            <p style="margin:0 0 10px">Você foi adicionado como <b>Admin</b> da empresa <b>${result.tenant.name}</b>.</p>
            <p style="margin:0 0 14px">Clique para criar sua senha:</p>
            <p style="margin:16px 0">
              <a href="${inviteUrl}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">
                Criar senha
              </a>
            </p>
            <p style="margin:0;color:#64748b;font-size:12px">Se não esperava este convite, ignore.</p>
          </div>
        `
      });
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

      sendInviteRequested: sendInvite,
      inviteEmail,
      asaas
    });
  } catch (err) {
    const msg = String(err?.message || "");
    logger.error({ err, msg }, "admin.tenants.create error");

    if (err?.code === "COMPANY_INVALID" || msg.includes("companyProfile inválido")) {
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
// ===============================
router.patch("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const name = req.body?.name != null ? safeStr(req.body.name) : undefined;
    const slug = req.body?.slug != null ? normalizeSlug(req.body.slug) : undefined;
    const isActive = req.body?.isActive;

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

    const updated = await prisma.tenant.update({ where: { id }, data });
    res.json({ ok: true, tenant: updated });
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
    const chargeEnabledRaw = req.body?.chargeEnabled !== undefined ? Boolean(req.body.chargeEnabled) : undefined;

    const billingCycle = req.body?.billingCycle !== undefined ? String(req.body.billingCycle) : undefined;
    const preferredMethod = req.body?.preferredMethod !== undefined ? String(req.body.preferredMethod) : undefined;

    const billingEmail = req.body?.billingEmail !== undefined ? safeStr(req.body.billingEmail) || null : undefined;

    const graceDaysAfterDue =
      req.body?.graceDaysAfterDue !== undefined ? Math.max(1, Number(req.body.graceDaysAfterDue)) : undefined;

    const asaasGroupName =
      req.body?.asaasGroupName !== undefined
        ? safeStr(req.body.asaasGroupName) || defaults.asaasGroupName
        : undefined;

    const asaasCustomerAccountGroup =
      req.body?.asaasCustomerAccountGroup !== undefined
        ? safeStr(req.body.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup
        : undefined;

    const current = await prisma.tenantBilling.findUnique({ where: { tenantId } });
    if (!current) return res.status(404).json({ error: "Billing não encontrado (tenantBilling missing)" });

    const finalIsFree = isFree !== undefined ? isFree : current.isFree;
    const finalChargeEnabled =
      finalIsFree === true ? false : (chargeEnabledRaw !== undefined ? chargeEnabledRaw : current.chargeEnabled);

    // ✅ se virar paid, força bloquear até pagar
    const nextAccessStatus =
      finalIsFree === true ? "ACTIVE" : (current.accessStatus === "ACTIVE" ? "ACTIVE" : "PENDING_PAYMENT");

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
        asaasCustomerAccountGroup,
        accessStatus: nextAccessStatus
      }
    });

    res.json({ ok: true, billing: updated });
  } catch (err) {
    logger.error({ err }, "admin.tenants.billing.patch error");
    res.status(500).json({ error: "Falha ao atualizar billing" });
  }
});

// ===============================
// POST /admin/tenants/:id/bootstrap
// (igual ao teu — já com early-return se Default existir)
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
      const group = await tx.group.create({
        data: { tenantId, name: "Default", isActive: true, maxChatsPerAgent: 3 }
      });

      let added = 0;

      if (addAdminsToGroup) {
        const admins = await tx.userTenant.findMany({
          where: { tenantId, isActive: true, role: "admin" }
        });

        for (const m of admins) {
          await tx.groupMember.upsert({
            where: { tenantId_groupId_userId: { tenantId, groupId: group.id, userId: m.userId } },
            create: { tenantId, groupId: group.id, userId: m.userId, role: "member", isActive: true },
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
// POST /admin/tenants/:id/billing/sync
// (mantive stub)
// ===============================
router.post("/:id/billing/sync", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { companyProfile: true, billing: true }
    });

    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });
    if (!tenant.billing) return res.status(404).json({ error: "Billing não encontrado" });

    const defaults = asaasGroupDefaults();

    const billing = await prisma.tenantBilling.update({
      where: { tenantId },
      data: {
        status: "PENDING_SYNC",
        asaasGroupName: tenant.billing.asaasGroupName || defaults.asaasGroupName,
        asaasCustomerAccountGroup: tenant.billing.asaasCustomerAccountGroup || defaults.asaasCustomerAccountGroup
      }
    });

    const hasCompany = Boolean(tenant.companyProfile?.cnpj && tenant.companyProfile?.legalName);

    let nextStatus = "PENDING_SYNC";
    let lastError = null;

    if (!hasCompany) {
      nextStatus = "ERROR";
      lastError = "company_profile_missing";
    } else {
      nextStatus = billing.asaasCustomerId ? "SYNCED" : "PENDING_SYNC";
    }

    const updated = await prisma.tenantBilling.update({
      where: { tenantId },
      data: { status: nextStatus, lastError, lastSyncAt: new Date() }
    });

    res.json({
      ok: true,
      tenantId,
      note: "Sync stub aplicado.",
      billing: updated
    });
  } catch (err) {
    logger.error({ err }, "admin.tenants.billing.sync error");
    res.status(500).json({ error: "Falha ao sincronizar billing" });
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
