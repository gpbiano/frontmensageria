// backend/src/routes/admin/usersAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";

const router = express.Router();

function safeStr(v) {
  return String(v || "").trim();
}

function safeBool(v) {
  if (v === true || v === false) return v;
  const s = String(v || "").toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return undefined;
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
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

/**
 * GET /admin/users
 * Query:
 * - q: busca por email/nome
 * - page, pageSize
 * - isActive=true|false (opcional)
 * - isSuperAdmin=true|false (opcional)
 */
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));

    const q = safeStr(req.query.q);
    const isActive = safeBool(req.query.isActive);
    const isSuperAdmin = safeBool(req.query.isSuperAdmin);

    const where = {
      ...(q
        ? {
            OR: [
              { email: { contains: q, mode: "insensitive" } },
              { name: { contains: q, mode: "insensitive" } }
            ]
          }
        : {}),
      ...(isActive !== undefined ? { isActive } : {}),
      ...(isSuperAdmin !== undefined ? { isSuperAdmin } : {})
    };

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);

    res.json({
      ok: true,
      page,
      pageSize,
      total,
      items: items.map(sanitizeUser)
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao listar usuários" });
  }
});

/**
 * GET /admin/users/:id
 * Retorna usuário + memberships (tenants)
 */
router.get("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        tenants: {
          include: { tenant: true },
          orderBy: { createdAt: "desc" }
        }
      }
    });

    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    res.json({
      ok: true,
      user: sanitizeUser(user),
      tenants: (user.tenants || []).map((ut) => ({
        id: ut.id,
        tenantId: ut.tenantId,
        role: ut.role,
        isActive: ut.isActive,
        createdAt: ut.createdAt,
        updatedAt: ut.updatedAt,
        tenant: ut.tenant
          ? {
              id: ut.tenant.id,
              slug: ut.tenant.slug,
              name: ut.tenant.name,
              isActive: ut.tenant.isActive
            }
          : null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao buscar usuário" });
  }
});

/**
 * POST /admin/users
 * Cria usuário global (não cria membership automaticamente)
 * Body:
 * {
 *   email: string,
 *   name?: string,
 *   role?: string,          // role global (opcional)
 *   isActive?: boolean,
 *   isSuperAdmin?: boolean
 * }
 */
router.post("/", async (req, res) => {
  try {
    const email = safeStr(req.body?.email).toLowerCase();
    const name = req.body?.name != null ? safeStr(req.body.name) : null;
    const role = req.body?.role != null ? safeStr(req.body.role) : "agent";
    const isActive = req.body?.isActive !== undefined ? Boolean(req.body.isActive) : true;
    const isSuperAdmin = req.body?.isSuperAdmin !== undefined ? Boolean(req.body.isSuperAdmin) : false;

    if (!email || !email.includes("@")) return res.status(400).json({ error: "email inválido" });

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: "email já existe" });

    const user = await prisma.user.create({
      data: { email, name, role, isActive, isSuperAdmin }
    });

    res.status(201).json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao criar usuário" });
  }
});

/**
 * PATCH /admin/users/:id
 * Atualiza name/role/isActive
 */
router.patch("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const data = {};
    if (req.body?.name !== undefined) data.name = req.body?.name == null ? null : safeStr(req.body.name);
    if (req.body?.role !== undefined) data.role = safeStr(req.body.role) || "agent";
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const user = await prisma.user.update({
      where: { id },
      data
    });

    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao atualizar usuário" });
  }
});

/**
 * PATCH /admin/users/:id/promote-superadmin
 */
router.patch("/:id/promote-superadmin", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const user = await prisma.user.update({
      where: { id },
      data: { isSuperAdmin: true }
    });
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao promover super-admin" });
  }
});

/**
 * PATCH /admin/users/:id/revoke-superadmin
 * ⚠️ proteção: evita remover do último super-admin (boa prática)
 */
router.patch("/:id/revoke-superadmin", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const count = await prisma.user.count({ where: { isSuperAdmin: true, isActive: true } });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "Usuário não encontrado" });

    if (target.isSuperAdmin === true && count <= 1) {
      return res.status(400).json({ error: "Não é permitido remover o último super-admin ativo" });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { isSuperAdmin: false }
    });

    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao revogar super-admin" });
  }
});

/**
 * PATCH /admin/users/:id/activate
 */
router.patch("/:id/activate", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const user = await prisma.user.update({
      where: { id },
      data: { isActive: true }
    });
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao ativar usuário" });
  }
});

/**
 * PATCH /admin/users/:id/deactivate
 * ⚠️ proteção: evita desativar o último super-admin ativo
 */
router.patch("/:id/deactivate", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const count = await prisma.user.count({ where: { isSuperAdmin: true, isActive: true } });
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) return res.status(404).json({ error: "Usuário não encontrado" });

    if (target.isSuperAdmin === true && count <= 1) {
      return res.status(400).json({ error: "Não é permitido desativar o último super-admin ativo" });
    }

    const user = await prisma.user.update({
      where: { id },
      data: { isActive: false }
    });

    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao desativar usuário" });
  }
});

/**
 * POST /admin/users/:id/reset-password
 * Gera PasswordToken (type=reset) para um tenant específico.
 *
 * Body:
 * {
 *   tenantId: string,
 *   ttlDays?: number (default 1)
 * }
 *
 * Retorna:
 * { token: <passwordToken.id>, expiresAt }
 *
 * (Modo compat: token = id do PasswordToken)
 */
router.post("/:id/reset-password", async (req, res) => {
  try {
    const userId = safeStr(req.params.id);
    const tenantId = safeStr(req.body?.tenantId);
    const ttlDays = Math.min(7, Math.max(1, Number(req.body?.ttlDays || 1)));

    if (!tenantId) return res.status(400).json({ error: "tenantId obrigatório" });

    const [user, tenant] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.tenant.findUnique({ where: { id: tenantId } })
    ]);

    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    if (!tenant) return res.status(404).json({ error: "Tenant não encontrado" });

    // opcional: valida se user pertence ao tenant, senão não faz sentido reset por tenant
    const membership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } }
    });
    if (!membership) {
      return res.status(400).json({ error: "Usuário não pertence a este tenant" });
    }

    const expiresAt = addDays(ttlDays);
    const tokenRow = await prisma.passwordToken.create({
      data: {
        tenantId,
        userId,
        type: "reset",
        expiresAt,
        used: false
      }
    });

    res.status(201).json({
      ok: true,
      token: tokenRow.id,
      expiresAt: tokenRow.expiresAt
    });
  } catch (err) {
    res.status(500).json({ error: "Falha ao gerar reset de senha" });
  }
});

export default router;
