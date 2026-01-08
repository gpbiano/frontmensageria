// backend/src/routes/admin/tenantsAdminRouter.js
import express from "express";
import crypto from "crypto";
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
  d.setDate(d.getDate() + days);
  return d;
}

function normalizeCnpj(v) {
  return safeStr(v).replace(/\D+/g, "");
}

function asaasGroupDefaults() {
  // ✅ seus defaults
  return {
    asaasGroupName: "ClienteOnline - GP Labs",
    asaasCustomerAccountGroup: "305006"
  };
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
        include: {
          billing: true
        }
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

    res.json({
      ok: true,
      tenant,
      companyProfile: tenant.companyProfile || null,
      billing: tenant.billing || null,
      members
    });
  } catch (err) {
    logger.error({ err }, "admin.tenants.get error");
    res.status(500).json({ error: "Falha ao buscar tenant" });
  }
});

// ===============================
// POST /admin/tenants
// cria tenant + user admin + companyProfile + billing + invite
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

    if (!name) return res.status(400).json({ error: "name obrigatório" });
    if (!adminEmail || !adminEmail.includes("@")) {
      return res.status(400).json({ error: "adminEmail inválido" });
    }

    const slug = normalizeSlug(slugRaw || name);
    if (!slug) return res.status(400).json({ error: "slug inválido" });

    const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
    if (existingSlug) return res.status(409).json({ error: "slug já existe" });

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name, slug, isActive: true }
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

      // companyProfile (opcional)
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

      // billing (cria sempre; defaults pro grupo)
      const defaults = asaasGroupDefaults();

      const isFree = billing?.isFree !== undefined ? Boolean(billing.isFree) : true;
      const chargeEnabled =
        isFree === true ? false : Boolean(billing?.chargeEnabled === true);

      const b = await tx.tenantBilling.upsert({
        where: { tenantId: tenant.id },
        create: {
          tenantId: tenant.id,
          provider: "asaas",
          status: "not_configured",

          planCode: safeStr(billing?.planCode) || "free",
          pricingRef: safeStr(billing?.pricingRef) || null,

          isFree,
          chargeEnabled,

          billingEmail: safeStr(billing?.billingEmail) || null,

          asaasGroupName: safeStr(billing?.asaasGroupName) || defaults.asaasGroupName,
          asaasCustomerAccountGroup:
            safeStr(billing?.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup
        },
        update: {
          planCode: billing?.planCode !== undefined ? safeStr(billing.planCode) : undefined,
          pricingRef: billing?.pricingRef !== undefined ? safeStr(billing.pricingRef) || null : undefined,

          isFree: billing?.isFree !== undefined ? Boolean(billing.isFree) : undefined,
          chargeEnabled:
            billing?.chargeEnabled !== undefined
              ? (isFree === true ? false : Boolean(billing.chargeEnabled))
              : undefined,

          billingEmail: billing?.billingEmail !== undefined ? safeStr(billing.billingEmail) || null : undefined,

          asaasGroupName:
            billing?.asaasGroupName !== undefined
              ? safeStr(billing.asaasGroupName) || defaults.asaasGroupName
              : undefined,

          asaasCustomerAccountGroup:
            billing?.asaasCustomerAccountGroup !== undefined
              ? safeStr(billing.asaasCustomerAccountGroup) || defaults.asaasCustomerAccountGroup
              : undefined
        }
      });

      // invite token (compat: usa id)
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

    const safeUser = {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      role: result.user.role,
      isActive: result.user.isActive,
      isSuperAdmin: result.user.isSuperAdmin === true,
      createdAt: result.user.createdAt,
      updatedAt: result.user.updatedAt
    };

    const invite = { token: result.passwordToken.id, expiresAt: result.passwordToken.expiresAt };

    res.status(201).json({
      ok: true,
      tenant: result.tenant,
      adminUser: safeUser,
      membership: result.membership,
      companyProfile: result.companyProfile,
      billing: result.billing,
      invite,
      sendInviteRequested: sendInvite
    });
  } catch (err) {
    const msg = String(err?.message || "");
    logger.error({ err, msg }, "admin.tenants.create error");

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
// salva regra FREE/CHARGE + pricingRef + grupo asaas
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

    const billingEmail = req.body?.billingEmail !== undefined ? safeStr(req.body.billingEmail) || null : undefined;

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
      finalIsFree === true ? false : (chargeEnabledRaw !== undefined ? chargeEnabledRaw : current.chargeEnabled);

    const updated = await prisma.tenantBilling.update({
      where: { tenantId },
      data: {
        planCode,
        pricingRef,
        isFree: isFree !== undefined ? finalIsFree : undefined,
        chargeEnabled: finalChargeEnabled,
        billingEmail,
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
// ===============================
router.post("/:id/bootstrap", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.id);
    const addAdminsToGroup = Boolean(req.body?.addAdminsToGroup !== false);

    // garante tenant
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const result = await prisma.$transaction(async (tx) => {
      // 1) cria grupo Default se não existir
      const defaultGroupName = "Default";
      const group = await tx.group.upsert({
        where: { tenantId_name: { tenantId, name: defaultGroupName } },
        create: {
          tenantId,
          name: defaultGroupName,
          isActive: true,
          maxChatsPerAgent: 3
        },
        update: { isActive: true }
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

    res.json({ ok: true, tenantId, bootstrap: result });
  } catch (err) {
    logger.error({ err }, "admin.tenants.bootstrap error");
    res.status(500).json({ error: "Falha no bootstrap" });
  }
});

// ===============================
// POST /admin/tenants/:id/billing/sync
// Aqui é o gancho do Asaas. Não invento preço.
// Regras:
// - SEMPRE cria/atualiza customer e envia pro grupo (customerAccountGroup=305006)
// - Se isFree=true -> NÃO cria assinatura
// - Se isFree=false e chargeEnabled=true -> cria assinatura (somente se você tiver pricingRef/preço definido depois)
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

    // garante grupo default salvo no billing
    const billing = await prisma.tenantBilling.update({
      where: { tenantId },
      data: {
        status: "pending_sync",
        asaasGroupName: tenant.billing.asaasGroupName || defaults.asaasGroupName,
        asaasCustomerAccountGroup:
          tenant.billing.asaasCustomerAccountGroup || defaults.asaasCustomerAccountGroup
      }
    });

    // ✅ Aqui você chamaria o SDK/HTTP do Asaas.
    // Eu NÃO vou inventar o client. Então vou deixar a estrutura exata.
    //
    // Fluxo esperado:
    // 1) upsert Customer no Asaas com dados da empresa (cnpj, endereço, email)
    // 2) garantir customer no grupo (customerAccountGroup=305006)
    // 3) se billing.isFree === false e billing.chargeEnabled === true:
    //    - criar assinatura usando pricingRef (quando você definir seu modelo/preço)
    //
    // Por enquanto: marca como synced se customer já existir, ou mantém pending.
    //
    // Se quiser, no próximo passo eu te entrego o asaasClient.js completo (fetch/axios) + envs.

    const hasCompany = Boolean(tenant.companyProfile?.cnpj && tenant.companyProfile?.legalName);

    let nextStatus = "pending_sync";
    let lastError = null;

    if (!hasCompany) {
      nextStatus = "error";
      lastError = "company_profile_missing";
    } else {
      // sem integração ainda: mantém pending (ou synced se já tem customerId)
      nextStatus = billing.asaasCustomerId ? "synced" : "pending_sync";
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

export default router;
