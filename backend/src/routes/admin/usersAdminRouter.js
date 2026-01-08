// backend/src/routes/admin/usersAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";

const router = express.Router();

function safeStr(v) {
  return String(v || "").trim();
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
 * Lista usuários globais (com busca e paginação)
 */
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
    const q = safeStr(req.query.q);

    const where = q
      ? {
          OR: [
            { email: { contains: q, mode: "insensitive" } },
            { name: { contains: q, mode: "insensitive" } }
          ]
        }
      : {};

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
 */
router.get("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });
    res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao buscar usuário" });
  }
});

/**
 * PATCH /admin/users/:id
 * Atualiza campos básicos (name, role, isActive) - opcional
 */
router.patch("/:id", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const data = {};
    if (req.body?.name !== undefined) data.name = safeStr(req.body.name) || null;
    if (req.body?.role !== undefined) data.role = safeStr(req.body.role) || "agent";
    if (req.body?.isActive !== undefined) data.isActive = Boolean(req.body.isActive);

    const updated = await prisma.user.update({ where: { id }, data });
    res.json({ ok: true, user: sanitizeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao atualizar usuário" });
  }
});

/**
 * PATCH /admin/users/:id/promote-superadmin
 * Promove um usuário para Super Admin
 *
 * Proteções:
 * - não deixa promover usuário inativo sem reativar
 */
router.patch("/:id/promote-superadmin", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    if (user.isSuperAdmin === true) {
      return res.json({ ok: true, already: true, user: sanitizeUser(user) });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isSuperAdmin: true, isActive: true }
    });

    res.json({ ok: true, user: sanitizeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao promover Super Admin" });
  }
});

/**
 * PATCH /admin/users/:id/revoke-superadmin
 * Revoga Super Admin
 *
 * Proteções:
 * - não permite revogar de si mesmo (evita lock acidental)
 * - não permite revogar se for o último Super Admin ativo
 */
router.patch("/:id/revoke-superadmin", async (req, res) => {
  try {
    const id = safeStr(req.params.id);

    // não deixa revogar de si mesmo
    const requesterId = safeStr(req.user?.id);
    if (requesterId && requesterId === id) {
      return res.status(400).json({ error: "Você não pode revogar seu próprio Super Admin." });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    if (user.isSuperAdmin !== true) {
      return res.json({ ok: true, already: true, user: sanitizeUser(user) });
    }

    // não deixa ficar sem nenhum super admin
    const superAdminsActive = await prisma.user.count({
      where: { isSuperAdmin: true, isActive: true }
    });

    if (superAdminsActive <= 1) {
      return res.status(400).json({ error: "Não é permitido remover o último Super Admin ativo." });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { isSuperAdmin: false }
    });

    res.json({ ok: true, user: sanitizeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: "Falha ao revogar Super Admin" });
  }
});

export default router;
