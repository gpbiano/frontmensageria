// backend/src/settings/groupsRouter.js
import express from "express";
import { prisma } from "../lib/prisma.js";

const router = express.Router();

/**
 * Helpers
 */
function mustHaveTenant(req, res) {
  const tenantId = req?.tenant?.id;
  if (!tenantId) {
    res.status(400).json({ error: "Tenant ausente no contexto.", code: "TENANT_REQUIRED" });
    return null;
  }
  return tenantId;
}

function parseBool(v, def = undefined) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return def;
}

/**
 * GET /settings/groups
 * Lista grupos do tenant
 * Query opcional: ?active=true|false
 */
router.get("/", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const active = parseBool(req.query.active, undefined);

    const groups = await prisma.group.findMany({
      where: {
        tenantId,
        ...(active === undefined ? {} : { isActive: active }),
      },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true } },
      },
    });

    return res.json(
      groups.map((g) => ({
        id: g.id,
        tenantId: g.tenantId,
        name: g.name,
        isActive: g.isActive,
        createdAt: g.createdAt,
        updatedAt: g.updatedAt,
        membersCount: g._count.members,
      }))
    );
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /settings/groups
 * body: { name }
 */
router.post("/", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Informe o nome do grupo." });

    const group = await prisma.group.create({
      data: { tenantId, name, isActive: true },
    });

    return res.status(201).json(group);
  } catch (e) {
    // unique (tenantId, name)
    if (String(e?.code || "") === "P2002") {
      return res.status(409).json({ error: "Já existe um grupo com esse nome." });
    }
    return next(e);
  }
});

/**
 * PATCH /settings/groups/:groupId
 * body: { name?, isActive? }
 */
router.patch("/:groupId", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId inválido." });

    const data = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: "name inválido." });
      data.name = name;
    }
    if (req.body?.isActive !== undefined) {
      data.isActive = !!req.body.isActive;
    }

    const updated = await prisma.group.updateMany({
      where: { id: groupId, tenantId },
      data,
    });

    if (!updated.count) return res.status(404).json({ error: "Grupo não encontrado." });

    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
      include: { _count: { select: { members: true } } },
    });

    return res.json({
      id: group.id,
      tenantId: group.tenantId,
      name: group.name,
      isActive: group.isActive,
      createdAt: group.createdAt,
      updatedAt: group.updatedAt,
      membersCount: group._count.members,
    });
  } catch (e) {
    if (String(e?.code || "") === "P2002") {
      return res.status(409).json({ error: "Já existe um grupo com esse nome." });
    }
    return next(e);
  }
});

/**
 * DELETE /settings/groups/:groupId
 * Remove grupo do tenant (hard delete)
 * Se preferir soft delete: trocar por update { isActive:false }
 */
router.delete("/:groupId", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId inválido." });

    // hard delete com cascata (GroupMember)
    const deleted = await prisma.group.deleteMany({
      where: { id: groupId, tenantId },
    });

    if (!deleted.count) return res.status(404).json({ error: "Grupo não encontrado." });

    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

/**
 * ===============================
 * MEMBERS
 * ===============================
 */

/**
 * GET /settings/groups/:groupId/members
 * Lista membros do grupo
 */
router.get("/:groupId/members", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId inválido." });

    // garante que group pertence ao tenant
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true, name: true, isActive: true },
    });
    if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

    const members = await prisma.groupMember.findMany({
      where: { tenantId, groupId },
      orderBy: { createdAt: "desc" },
      include: {
        user: { select: { id: true, email: true, name: true, isActive: true, role: true } },
      },
    });

    return res.json({
      group,
      members: members.map((m) => ({
        id: m.id,
        tenantId: m.tenantId,
        groupId: m.groupId,
        userId: m.userId,
        role: m.role,
        isActive: m.isActive,
        createdAt: m.createdAt,
        user: m.user,
      })),
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * POST /settings/groups/:groupId/members
 * body: { userId, role? }
 */
router.post("/:groupId/members", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId inválido." });

    const userId = String(req.body?.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Informe userId." });

    const role = String(req.body?.role || "member").trim() || "member";

    // group existe e é do tenant
    const group = await prisma.group.findFirst({
      where: { id: groupId, tenantId },
      select: { id: true },
    });
    if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

    // user existe
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, isActive: true },
    });
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    // upsert membership (reativa se já existe)
    const membership = await prisma.groupMember.upsert({
      where: {
        tenantId_groupId_userId: { tenantId, groupId, userId },
      },
      create: { tenantId, groupId, userId, role, isActive: true },
      update: { role, isActive: true },
      include: {
        user: { select: { id: true, email: true, name: true, isActive: true, role: true } },
      },
    });

    return res.status(201).json({
      id: membership.id,
      tenantId: membership.tenantId,
      groupId: membership.groupId,
      userId: membership.userId,
      role: membership.role,
      isActive: membership.isActive,
      createdAt: membership.createdAt,
      user: membership.user,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * PATCH /settings/groups/:groupId/members/:userId
 * body: { role?, isActive? }
 */
router.patch("/:groupId/members/:userId", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    const userId = String(req.params.userId || "").trim();
    if (!groupId || !userId) return res.status(400).json({ error: "Parâmetros inválidos." });

    const data = {};
    if (req.body?.role !== undefined) {
      const role = String(req.body.role || "").trim();
      if (!role) return res.status(400).json({ error: "role inválido." });
      data.role = role;
    }
    if (req.body?.isActive !== undefined) {
      data.isActive = !!req.body.isActive;
    }

    const updated = await prisma.groupMember.updateMany({
      where: { tenantId, groupId, userId },
      data,
    });

    if (!updated.count) return res.status(404).json({ error: "Membro não encontrado." });

    const membership = await prisma.groupMember.findFirst({
      where: { tenantId, groupId, userId },
      include: {
        user: { select: { id: true, email: true, name: true, isActive: true, role: true } },
      },
    });

    return res.json({
      id: membership.id,
      tenantId: membership.tenantId,
      groupId: membership.groupId,
      userId: membership.userId,
      role: membership.role,
      isActive: membership.isActive,
      createdAt: membership.createdAt,
      user: membership.user,
    });
  } catch (e) {
    return next(e);
  }
});

/**
 * DELETE /settings/groups/:groupId/members/:userId
 * Remove membro do grupo (hard delete)
 * Se preferir soft delete: update isActive=false
 */
router.delete("/:groupId/members/:userId", async (req, res, next) => {
  try {
    const tenantId = mustHaveTenant(req, res);
    if (!tenantId) return;

    const groupId = String(req.params.groupId || "").trim();
    const userId = String(req.params.userId || "").trim();
    if (!groupId || !userId) return res.status(400).json({ error: "Parâmetros inválidos." });

    const deleted = await prisma.groupMember.deleteMany({
      where: { tenantId, groupId, userId },
    });

    if (!deleted.count) return res.status(404).json({ error: "Membro não encontrado." });

    return res.json({ ok: true });
  } catch (e) {
    return next(e);
  }
});

export default router;
