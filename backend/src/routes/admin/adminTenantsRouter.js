// backend/src/routes/admin/tenantsAdminRouter.js
import express from "express";
import crypto from "crypto";
import { prisma } from "../../lib/prisma.js";
import { asaasCreateCustomer } from "../../services/asaasClient.js";

// helpers
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

function normalizeDigits(v) {
  return String(v || "").replace(/\D+/g, "");
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

function buildInviteToken() {
  // token opaco para link (não o id do PasswordToken)
  return crypto.randomBytes(32).toString("hex");
}

/**
 * IMPORTANTE:
 * - Seu fluxo atual usa PasswordToken.id como token (modo compat)
 * - buildInviteToken() fica guardado para quando você adicionar `token` no schema
 */

const router = express.Router();

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

function getDefaultAsaasGroupName() {
  return (
    String(process.env.ASAAS_GROUP_NAME || "").trim() ||
    "ClienteOnline - GP Labs"
  );
}

function getDefaultAsaasCustomerAccountGroup() {
  return (
    String(process.env.ASAAS_CUSTOMER_ACCOUNT_GROUP || "").trim() ||
    "305006"
  );
}

/**
 * GET /admin/tenants
 * Lista tenants (com paginação simples)
 * - inclui billing/status resumido para a listagem
 */
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
        include: {
          billing: true,
          companyProfile: true
        }
      })
    ]);

    res.json({
      ok: true,
      page,
      pageSize,
      total,
      items: items.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        isActive: t.isActive,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        companyProfile: t.companyProfile
          ? {
              legalName: t.companyProfile.legalName,
              cnpj: t.companyProfile.cnpj,
              postalCode: t.companyProfile.postalCode,
              city: t.companyProfile.city,
              state: t.companyProfile.state
            }
          : null,
        billing: t.billing
          ? {
              provider: t.billing.provider,
              status: t.billing.status,
              planCode: t.billing.planCode,
              isFree: t.billing.isFree,
              chargeEnabled: t.billing.chargeEnabled,
              pricingRef: t.billing.pricingRef,
              asaasCustomerId: t.billing.asaasCustomerId,
              asaasGroupName: t.billing.asaasGroupName,
              asaasCustomerAccountGroup: t.billing.asaasCustomerAccountGroup,
              lastSyncAt: t.billing.lastSyncAt,
              lastError: t.billing.lastError
            }
          : null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao listar tenants" });
  }
});

/**
 * GET /admin/tenants/:id
 * ✅ Detalhado: tenant + companyProfile + billing + members
 */
router.get("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const tenant = await prisma.tenant.findUnique({
      where: { id },
      include: {
        companyProfile: true,
        billing: true,
        users: {
          include: { user: true },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    res.json({
      ok: true,
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt
      },
      companyProfile: tenant.companyProfile,
      billing: tenant.billing,
      members: (tenant.users || []).map((ut) => ({
        id: ut.id,
        tenantId: ut.tenantId,
        userId: ut.userId,
        role: ut.role,
        isActive: ut.isActive,
        createdAt: ut.createdAt,
        updatedAt: ut.updatedAt,
        user: sanitizeUser(ut.user)
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao buscar tenant" });
  }
});

/**
 * POST /admin/tenants
 * ✅ Cria Tenant COMPLETO (Admin + CompanyProfile + Billing)
 *
 * Body:
 * {
 *   "name": "Empresa X",
 *   "slug": "empresa-x" (opcional),
 *   "adminEmail": "admin@empresa.com",
 *   "adminName": "Admin Empresa" (opcional),
 *
 *   "companyProfile": {
 *     "legalName": "...", "tradeName": "...", "cnpj": "...",
 *     "ie": "...", "im": "...",
 *     "postalCode": "...", "address": "...", "addressNumber": "...",
 *     "complement": "...", "province": "...", "city": "...", "state": "...", "country": "BR"
 *   },
 *
 *   "billing": {
 *     "planCode": "free|pro|...",
 *     "isFree": true|false,
 *     "chargeEnabled": true|false,
 *     "pricingRef": "R$199/mês|ASAAS_PLAN_X|...",
 *     "billingEmail": "financeiro@...",
 *     "asaasGroupName": "ClienteOnline - GP Labs",
 *     "asaasCustomerAccountGroup": "305006"
 *   },
 *
 *   "sendInvite": true (opcional),
 *   "inviteTtlDays": 7 (opcional)
 * }
 *
 * Retorna:
 * - tenant + companyProfile + billing
 * - adminUser (sem passwordHash)
 * - invite: { token, expiresAt } (modo compat: token = passwordToken.id)
 */
router.post("/", async (req, res) => {
  try {
    const name = safeStr(req.body?.name);
    const slugRaw = safeStr(req.body?.slug);

    // Admin do tenant
    const adminEmail = safeStr(req.body?.adminEmail).toLowerCase();
    const adminName = safeStr(req.body?.adminName) || null;

    const sendInvite = req.body?.sendInvite !== false; // default true
    const inviteTtlDays = Math.min(30, Math.max(1, Number(req.body?.inviteTtlDays || 7)));

    // Company profile
    const cp = req.body?.companyProfile || {};
    const legalName = safeStr(cp.legalName);
    const tradeName = safeStr(cp.tradeName) || null;
    const cnpj = normalizeDigits(cp.cnpj);
    const ie = safeStr(cp.ie) || null;
    const im = safeStr(cp.im) || null;

    const postalCode = normalizeDigits(cp.postalCode);
    const address = safeStr(cp.address);
    const addressNumber = safeStr(cp.addressNumber);
    const complement = safeStr(cp.complement) || null;
    const province = safeStr(cp.province) || null;
    const city = safeStr(cp.city) || null;
    const state = safeStr(cp.state) || null;
    const country = safeStr(cp.country) || "BR";

    // Billing (aberto pra depois)
    const b = req.body?.billing || {};
    const planCode = safeStr(b.planCode) || "free";
    const isFree = planCode === "free" ? true : Boolean(b.isFree);
    const chargeEnabled = isFree ? false : (b.chargeEnabled === true); // default false
    const pricingRef = safeStr(b.pricingRef) || null;
    const billingEmail = safeStr(b.billingEmail || adminEmail).toLowerCase() || null;

    // ✅ Sempre mandar pro grupo (defaults por env)
    const asaasGroupName =
      safeStr(b.asaasGroupName) || getDefaultAsaasGroupName();

    const asaasCustomerAccountGroup =
      safeStr(b.asaasCustomerAccountGroup) || getDefaultAsaasCustomerAccountGroup();

    // validações mínimas
    if (!name) return res.status(400).json({ error: "name obrigatório" });
    if (!adminEmail || !adminEmail.includes("@")) {
      return res.status(400).json({ error: "adminEmail inválido" });
    }

    if (!legalName) return res.status(400).json({ error: "companyProfile.legalName obrigatório" });
    if (!cnpj) return res.status(400).json({ error: "companyProfile.cnpj obrigatório" });
    if (!postalCode) return res.status(400).json({ error: "companyProfile.postalCode obrigatório" });
    if (!address) return res.status(400).json({ error: "companyProfile.address obrigatório" });
    if (!addressNumber) return res.status(400).json({ error: "companyProfile.addressNumber obrigatório" });

    const slug = normalizeSlug(slugRaw || name);
    if (!slug) return res.status(400).json({ error: "slug inválido" });

    // evita slug duplicado
    const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existingSlug) {
      return res.status(409).json({ error: "slug já existe" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1) Tenant
      const tenant = await tx.tenant.create({
        data: { name, slug, isActive: true }
      });

      // 2) Company Profile
      const companyProfile = await tx.tenantCompanyProfile.create({
        data: {
          tenantId: tenant.id,
          legalName,
          tradeName,
          cnpj,
          ie,
          im,
          postalCode,
          address,
          addressNumber,
          complement,
          province,
          city,
          state,
          country
        }
      });

      // 3) Billing row (sempre com grupo preenchido)
      const billingRow = await tx.tenantBilling.create({
        data: {
          tenantId: tenant.id,
          provider: "asaas",
          status: "pending_sync",

          planCode,
          isFree,
          chargeEnabled,
          pricingRef,
          billingEmail,

          asaasGroupName,
          asaasCustomerAccountGroup
        }
      });

      // 4) Admin user (global)
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

      // 5) membership admin
      const membership = await tx.userTenant.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: tenant.id } },
        create: {
          userId: user.id,
          tenantId: tenant.id,
          role: "admin",
          isActive: true
        },
        update: {
          role: "admin",
          isActive: true
        }
      });

      // 6) PasswordToken invite (modo compat: token = id)
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

      return { tenant, companyProfile, billingRow, user, membership, passwordToken };
    });

    const invite = {
      token: result.passwordToken.id,
      expiresAt: result.passwordToken.expiresAt
    };

    res.status(201).json({
      ok: true,
      tenant: result.tenant,
      companyProfile: result.companyProfile,
      billing: result.billingRow,
      adminUser: sanitizeUser(result.user),
      membership: result.membership,
      invite,
      sendInviteRequested: sendInvite
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("Unique constraint") || msg.includes("unique")) {
      return res.status(409).json({ error: "Conflito de dados (unique)" });
    }
    res.status(500).json({ error: "Falha ao criar tenant completo" });
  }
});

/**
 * PATCH /admin/tenants/:id
 * Atualiza name/slug/isActive
 */
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
      if (existing && existing.id !== id) {
        return res.status(409).json({ error: "slug já existe" });
      }
      data.slug = slug;
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive);

    const updated = await prisma.tenant.update({
      where: { id },
      data
    });

    res.json({ ok: true, tenant: updated });
  } catch (err) {
    res.status(500).json({ error: "Falha ao atualizar tenant" });
  }
});

/**
 * PATCH /admin/tenants/:id/activate
 */
router.patch("/:id/activate", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const tenant = await prisma.tenant.update({
      where: { id },
      data: { isActive: true }
    });
    res.json({ ok: true, tenant });
  } catch (err) {
    res.status(500).json({ error: "Falha ao ativar tenant" });
  }
});

/**
 * PATCH /admin/tenants/:id/deactivate
 */
router.patch("/:id/deactivate", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const tenant = await prisma.tenant.update({
      where: { id },
      data: { isActive: false }
    });
    res.json({ ok: true, tenant });
  } catch (err) {
    res.status(500).json({ error: "Falha ao desativar tenant" });
  }
});

//
// BILLING ROUTES (Admin)
//

/**
 * PATCH /admin/tenants/:id/billing
 * Atualiza campos de billing (plano/preço/switch etc)
 * - mantém regra: se isFree=true -> força chargeEnabled=false
 * - mantém regra: asaasGroupName sempre preenchido (default env)
 */
router.patch("/:id/billing", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);

    const existing = await prisma.tenantBilling.findUnique({ where: { tenantId } });

    const planCode = req.body?.planCode !== undefined ? safeStr(req.body.planCode) : undefined;
    const isFree = req.body?.isFree !== undefined ? Boolean(req.body.isFree) : undefined;
    const chargeEnabled = req.body?.chargeEnabled !== undefined ? Boolean(req.body.chargeEnabled) : undefined;
    const pricingRef = req.body?.pricingRef !== undefined ? (safeStr(req.body.pricingRef) || null) : undefined;
    const billingEmail = req.body?.billingEmail !== undefined ? (safeStr(req.body.billingEmail) || null) : undefined;

    const asaasGroupName =
      req.body?.asaasGroupName !== undefined
        ? (safeStr(req.body.asaasGroupName) || getDefaultAsaasGroupName())
        : undefined;

    const asaasCustomerAccountGroup =
      req.body?.asaasCustomerAccountGroup !== undefined
        ? (safeStr(req.body.asaasCustomerAccountGroup) || getDefaultAsaasCustomerAccountGroup())
        : undefined;

    const data = {};

    if (planCode !== undefined) data.planCode = planCode || null;
    if (isFree !== undefined) data.isFree = isFree;
    if (pricingRef !== undefined) data.pricingRef = pricingRef;
    if (billingEmail !== undefined) data.billingEmail = billingEmail;

    if (asaasGroupName !== undefined) data.asaasGroupName = asaasGroupName;
    if (asaasCustomerAccountGroup !== undefined) data.asaasCustomerAccountGroup = asaasCustomerAccountGroup;

    // chargeEnabled depende de isFree (prioridade total)
    if (chargeEnabled !== undefined) data.chargeEnabled = chargeEnabled;

    // Se isFree=true, força chargeEnabled=false
    const finalIsFree = isFree !== undefined ? isFree : existing?.isFree;
    if (finalIsFree === true) data.chargeEnabled = false;

    const updated = await prisma.tenantBilling.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: "asaas",
        status: "pending_sync",
        planCode: data.planCode ?? null,
        isFree: data.isFree ?? false,
        chargeEnabled: data.chargeEnabled ?? false,
        pricingRef: data.pricingRef ?? null,
        billingEmail: data.billingEmail ?? null,
        asaasGroupName: data.asaasGroupName ?? getDefaultAsaasGroupName(),
        asaasCustomerAccountGroup: data.asaasCustomerAccountGroup ?? getDefaultAsaasCustomerAccountGroup()
      },
      update: data
    });

    res.json({ ok: true, billing: updated });
  } catch (err) {
    res.status(500).json({ error: "Falha ao atualizar billing" });
  }
});

/**
 * POST /admin/tenants/:id/billing/sync
 * Cria Customer no Asaas (sempre vai para o grupo)
 * - NUNCA cria assinatura aqui (independente de free/pago)
 */
router.post("/:id/billing/sync", async (req, res) => {
  const tenantId = safeStr(req.params.id);

  try {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { companyProfile: true, billing: true }
    });

    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });
    if (!tenant.companyProfile) return res.status(400).json({ error: "Tenant sem companyProfile" });

    const billing = await prisma.tenantBilling.upsert({
      where: { tenantId },
      create: {
        tenantId,
        provider: "asaas",
        status: "pending_sync",
        planCode: "free",
        isFree: true,
        chargeEnabled: false,
        pricingRef: null,
        billingEmail: null,
        asaasGroupName: getDefaultAsaasGroupName(),
        asaasCustomerAccountGroup: getDefaultAsaasCustomerAccountGroup()
      },
      update: {}
    });

    // idempotência: se já tem customer, ok
    if (billing.asaasCustomerId) {
      return res.json({ ok: true, alreadySynced: true, billing });
    }

    const p = tenant.companyProfile;

    const groupName = billing.asaasGroupName || getDefaultAsaasGroupName();
    const customerAccountGroup = billing.asaasCustomerAccountGroup || getDefaultAsaasCustomerAccountGroup();

    const payload = {
      name: p.legalName,
      cpfCnpj: p.cnpj,
      email: billing.billingEmail || undefined,
      postalCode: p.postalCode,
      address: p.address,
      addressNumber: p.addressNumber,
      complement: p.complement || undefined,
      province: p.province || undefined,
      city: p.city || undefined,
      state: p.state || undefined,

      // ✅ sempre no grupo
      groupName
    };

    // tentativa opcional (se sua conta suportar esse campo)
    payload.customerAccountGroup = customerAccountGroup;

    let created;
    try {
      created = await asaasCreateCustomer(payload);
    } catch (err) {
      const msg = String(err?.message || "");
      // fallback: remove campo não reconhecido
      if ((err?.status === 400 || err?.status === 422) && msg.includes("customerAccountGroup")) {
        const retryPayload = { ...payload };
        delete retryPayload.customerAccountGroup;
        created = await asaasCreateCustomer(retryPayload);
      } else {
        throw err;
      }
    }

    const updated = await prisma.tenantBilling.update({
      where: { tenantId },
      data: {
        asaasCustomerId: created?.id || null,
        status: "synced",
        lastSyncAt: new Date(),
        lastError: null,
        // garante persistência do grupo
        asaasGroupName: groupName,
        asaasCustomerAccountGroup: customerAccountGroup
      }
    });

    res.json({
      ok: true,
      asaas: { customerId: created?.id, raw: created },
      billing: updated
    });
  } catch (err) {
    // registra erro no billing sem quebrar a plataforma
    try {
      await prisma.tenantBilling.upsert({
        where: { tenantId },
        create: {
          tenantId,
          provider: "asaas",
          status: "error",
          lastError: String(err?.message || "Asaas sync error"),
          lastSyncAt: new Date(),
          asaasGroupName: getDefaultAsaasGroupName(),
          asaasCustomerAccountGroup: getDefaultAsaasCustomerAccountGroup()
        },
        update: {
          status: "error",
          lastError: String(err?.message || "Asaas sync error"),
          lastSyncAt: new Date(),
          asaasGroupName: getDefaultAsaasGroupName(),
          asaasCustomerAccountGroup: getDefaultAsaasCustomerAccountGroup()
        }
      });
    } catch {}

    res.status(502).json({
      error: "Falha ao sincronizar com Asaas",
      details: String(err?.message || err)
    });
  }
});

export default router;
