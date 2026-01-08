// backend/src/routes/admin/membershipsAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";

const router = express.Router({ mergeParams: true });

function safeStr(v) {
  return String(v || "").trim();
}

function sanitizeMembership(m) {
  return {
    id: m.id,
    userId: m.userId,
    tenantId: m.tenantId,
    role: m.role,
    isActive: m.isActive,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    user: m.user
      ? {
          id: m.user.id,
          email: m.user.email,
          name: m.user.name,
          isActive: m.user.isActive
        }
      : null
  };
}

/**
 * GET /admin/tenants/:tenantId/members
 * Lista usuários do tenant
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.tenantId);

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    const members = await prisma.userTenant.findMany({
      where: { tenantId },
      include: { user: true },
      orderBy: { createdAt: "desc" }
    });

    res.json({
      ok: true,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug
      },
      members: members.map(sanitizeMembership)
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao listar membros do tenant" });
  }
});

/**
 * POST /admin/tenants/:tenantId/members
 *
 * Opção A — vincular usuário existente
 * {
 *   userId: string,
 *   role?: "admin" | "agent"
 * }
 *
 * Opção B — criar usuário novo e vincular
 * {
 *   email: string,
 *   name?: string,
 *   role?: "admin" | "agent",
 *   sendInvite?: boolean
 * }
 */
router.post("/", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.tenantId);
    const role = safeStr(req.body?.role || "agent");

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    let user;

    // 🔹 Caso A: user existente
    if (req.body?.userId) {
      const userId = safeStr(req.body.userId);
      user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // 🔹 Caso B: criar usuário novo
    if (!user && req.body?.email) {
      const email = safeStr(req.body.email).toLowerCase();
      const name = req.body?.name ? safeStr(req.body.name) : null;

      if (!email.includes("@")) {
        return res.status(400).json({ error: "email inválido" });
      }

      user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          name,
          role: "agent",
          isActive: true
        },
        update: {}
      });
    }

    if (!user) {
      return res.status(400).json({ error: "Informe userId ou email" });
    }

    // cria ou reativa membership
    const membership = await prisma.userTenant.upsert({
      where: {
        userId_tenantId: {
          userId: user.id,
          tenantId
        }
      },
      create: {
        userId: user.id,
        tenantId,
        role,
        isActive: true
      },
      update: {
        role,
        isActive: true
      },
      include: { user: true }
    });

    res.status(201).json({
      ok: true,
      membership: sanitizeMembership(membership)
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao adicionar membro ao tenant" });
  }
});

/**
 * PATCH /admin/tenants/:tenantId/members/:userId
 * Atualiza role / isActive
 */
router.patch("/:userId", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.tenantId);
    const userId = safeStr(req.params.userId);

    const data = {};
    if (req.body?.role !== undefined) data.role = safeStr(req.body.role);
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const membership = await prisma.userTenant.update({
      where: {
        userId_tenantId: {
          userId,
          tenantId
        }
      },
      data,
      include: { user: true }
    });

    res.json({
      ok: true,
      membership: sanitizeMembership(membership)
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao atualizar membership" });
  }
});

/**
 * DELETE /admin/tenants/:tenantId/members/:userId
 * Soft remove (isActive = false)
 */
router.delete("/:userId", async (req, res) => {
  try {
    const tenantId = safeStr(req.params.tenantId);
    const userId = safeStr(req.params.userId);

    const membership = await prisma.userTenant.update({
      where: {
        userId_tenantId: {
          userId,
          tenantId
        }
      },
      data: { isActive: false },
      include: { user: true }
    });

    res.json({
      ok: true,
      membership: sanitizeMembership(membership)
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao remover usuário do tenant" });
  }
});

export default router;
