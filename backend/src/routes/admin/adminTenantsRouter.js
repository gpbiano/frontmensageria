// backend/src/routes/admin/tenantsAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";
import logger from "../../logger.js";

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
  // coloque no .env: APP_WEB_URL=https://app.seudominio.com
  return (
    safeStr(process.env.APP_WEB_URL) ||
    safeStr(process.env.FRONTEND_URL) ||
    safeStr(process.env.PUBLIC_APP_URL) ||
    ""
  );
}

function getInvitePath() {
  // ajuste conforme sua tela de convite / criar senha
  // ex: /auth/invite?token=...
  return safeStr(process.env.INVITE_PATH) || "/auth/invite";
}

function buildInviteUrl(token) {
  const base = getAppWebUrl();
  const path = getInvitePath();

  if (!base) return ""; // sem base, retorna vazio (fallback: token no response)
  const u = new URL(path, base);
  u.searchParams.set("token", String(token || ""));
  return u.toString();
}

async function sendInviteEmailIfConfigured({ to, tenantName, token, expiresAt }) {
  // ✅ Se SMTP não estiver configurado, não quebra o fluxo
  const SMTP_HOST = safeStr(process.env.SMTP_HOST);
  const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
  const SMTP_USER = safeStr(process.env.SMTP_USER);
  const SMTP_PASS = safeStr(process.env.SMTP_PASS);
  const SMTP_SECURE = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
  const SMTP_FROM = safeStr(process.env.SMTP_FROM) || safeStr(process.env.MAIL_FROM) || "";

  if (!SMTP_HOST || !SMTP_FROM) {
    logger.warn(
      { SMTP_HOST: Boolean(SMTP_HOST), SMTP_FROM: Boolean(SMTP_FROM) },
      "invite email: SMTP não configurado (pulando envio)"
    );
    return { sent: false, reason: "smtp_not_configured" };
  }

  let nodemailer;
  try {
    nodemailer = (await import("nodemailer")).default || (await import("nodemailer"));
  } catch (err) {
    logger.warn({ err }, "invite email: nodemailer não disponível (pulando envio)");
    return { sent: false, reason: "nodemailer_missing" };
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_SECURE,
    auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
  });

  const inviteUrl = buildInviteUrl(token);

  const subject = `Bem-vindo ao GP Labs — Crie sua senha`;
  const exp = expiresAt ? new Date(expiresAt).toLocaleString("pt-BR") : "";

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.4">
    <h2 style="margin:0 0 12px">Bem-vindo ao GP Labs</h2>
    <p style="margin:0 0 10px">
      Você foi adicionado como <b>Admin</b> da empresa <b>${String(tenantName || "sua empresa")}</b>.
    </p>
    <p style="margin:0 0 14px">Clique no botão abaixo para criar sua senha e acessar a plataforma.</p>

    ${
      inviteUrl
        ? `<p style="margin:16px 0">
            <a href="${inviteUrl}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">
              Criar senha
            </a>
          </p>
          <p style="margin:0 0 10px;color:#475569;font-size:12px">
            Se o botão não funcionar, copie e cole este link no navegador:<br/>
            <span style="word-break:break-all">${inviteUrl}</span>
          </p>`
        : `<p style="margin:0 0 10px;color:#b45309">
            Link de convite não configurado no servidor (APP_WEB_URL). Token: <b>${String(token || "")}</b>
          </p>`
    }

    ${exp ? `<p style="margin:10px 0 0;color:#475569;font-size:12px">Este convite expira em: ${exp}</p>` : ""}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
    <p style="margin:0;color:#64748b;font-size:12px">
      Se você não esperava este convite, ignore este e-mail.
    </p>
  </div>
  `;

  try {
    await transport.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html
    });

    return { sent: true, inviteUrl };
  } catch (err) {
    logger.error({ err }, "invite email: falha ao enviar");
    return { sent: false, reason: "send_failed" };
  }
}

async function hasDefaultGroup(tenantId) {
  // ✅ usado para o front desabilitar bootstrap quando já existir Default
  const n = await prisma.group.count({
    where: { tenantId: String(tenantId), name: "Default" }
  });
  return n > 0;
}

// ===============================
// GET /admin/tenants
// lista tenants + billing (pra badges no front)
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
// retorna tenant + companyProfile + billing + members
// + hasDefaultGroup (pra UX do bootstrap)
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
// cria tenant + user admin + companyProfile + billing + invite
// + envia e-mail de boas-vindas (se sendInvite=true e SMTP configurado)
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

    // ✅ opcional: permitir criar já inativo via payload (se você quiser no front)
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

      // 3) membership no tenant
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

      // 5) billing (cria sempre; com enums do schema novo)
      const defaults = asaasGroupDefaults();

      const isFree = billing?.isFree !== undefined ? Boolean(billing.isFree) : true;

      // regra: free => chargeEnabled false sempre
      const chargeEnabled = isFree === true ? false : Boolean(billing?.chargeEnabled === true);

      // trial: somente se não for free
      const trialEndsAt = isFree ? null : addDays(7);

      // access status:
      // - free => ACTIVE (não bloqueia)
      // - paid => TRIALING (7 dias)
      const accessStatus = isFree ? "ACTIVE" : "TRIALING";

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

          graceDaysAfterDue:
            billing?.graceDaysAfterDue != null
              ? Math.max(1, Number(billing.graceDaysAfterDue))
              : undefined
        },
        update: {
          planCode: billing?.planCode !== undefined ? safeStr(billing.planCode) || null : undefined,
          pricingRef:
            billing?.pricingRef !== undefined ? safeStr(billing.pricingRef) || null : undefined,

          isFree: billing?.isFree !== undefined ? Boolean(billing.isFree) : undefined,
          chargeEnabled:
            billing?.chargeEnabled !== undefined
              ? isFree === true
                ? false
                : Boolean(billing.chargeEnabled)
              : undefined,

          billingCycle: billing?.billingCycle !== undefined ? String(billing.billingCycle) : undefined,
          preferredMethod:
            billing?.preferredMethod !== undefined ? String(billing.preferredMethod) : undefined,

          billingEmail:
            billing?.billingEmail !== undefined ? safeStr(billing.billingEmail) || null : undefined,

          asaasGroupName:
            billing?.asaasGroupName !== undefined
              ? safeStr(billing.asaasGroupName) || defaults.asaasGroupName
              : undefined,

          asaasCustomerAccountGroup:
            billing?.asaasCustomerAccountGroup !== undefined
              ? safeStr(billing.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup
              : undefined,

          graceDaysAfterDue:
            billing?.graceDaysAfterDue !== undefined
              ? Math.max(1, Number(billing.graceDaysAfterDue))
              : undefined
        }
      });

      // 6) invite token (token opaco)
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

    // ✅ Envia e-mail fora da transação (não “prende” criação por falha de SMTP)
    const inviteMail = sendInvite
      ? await sendInviteEmailIfConfigured({
          to: adminEmail,
          tenantName: result.tenant?.name,
          token: result.passwordToken.token,
          expiresAt: result.passwordToken.expiresAt
        })
      : { sent: false, reason: "sendInvite_false" };

    res.status(201).json({
      ok: true,
      tenant: result.tenant,
      adminUser: sanitizeUser(result.user),
      membership: result.membership,
      companyProfile: result.companyProfile,
      billing: result.billing,

      invite: {
        token: result.passwordToken.token,
        expiresAt: result.passwordToken.expiresAt,
        url: buildInviteUrl(result.passwordToken.token) || null
      },

      sendInviteRequested: sendInvite,
      inviteEmail: inviteMail
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
    const chargeEnabledRaw =
      req.body?.chargeEnabled !== undefined ? Boolean(req.body.chargeEnabled) : undefined;

    const billingCycle =
      req.body?.billingCycle !== undefined ? String(req.body.billingCycle) : undefined;

    const preferredMethod =
      req.body?.preferredMethod !== undefined ? String(req.body.preferredMethod) : undefined;

    const billingEmail =
      req.body?.billingEmail !== undefined ? safeStr(req.body.billingEmail) || null : undefined;

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
    if (!current) {
      return res.status(404).json({ error: "Billing não encontrado (tenantBilling missing)" });
    }

    // regra: free -> chargeEnabled false
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
// POST /admin/tenants/:id/bootstrap
// cria defaults do tenant (idempotente)
// ✅ retorna flag "alreadyBootstrapped" e não “faz nada” se Default já existe
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
// POST /admin/tenants/:id/billing/sync
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
        asaasCustomerAccountGroup:
          tenant.billing.asaasCustomerAccountGroup || defaults.asaasCustomerAccountGroup
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
      data: {
        status: nextStatus,
        lastError,
        lastSyncAt: new Date()
      }
    });

    res.json({
      ok: true,
      tenantId,
      note:
        "Sync Asaas stub aplicado. Próximo passo: implementar asaasClient (Customer + Grupo + Assinatura condicional).",
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
