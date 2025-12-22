// backend/src/settings/groupsRouter.js
import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import logger from "../logger.js";

const router = express.Router();

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId;
  return tenantId ? String(tenantId) : null;
}

function parseBoolean(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

function shapeGroup(g) {
  return {
    id: g.id,
    tenantId: g.tenantId,
    name: g.name,
    isActive: g.isActive !== false,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    membersCount: typeof g._count?.members === "number" ? g._count.members : undefined,
  };
}

function shapeMember(m) {
  return {
    id: m.id,
    tenantId: m.tenantId,
    groupId: m.groupId,
    userId: m.userId,
    role: m.role,
    isActive: m.isActive !== false,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    user: m.user
      ? {
          id: m.user.id,
          email: m.user.email,
          name: m.user.name || null,
          isActive: m.user.isActive !== false,
        }
      : undefined,
  };
}

/**
 * GET /settings/groups
 * (admin/manager/agent/viewer) - lista grupos do tenant
 */
router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const groups = await prisma.group.findMany({
        where: { tenantId },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        include: { _count: { select: { members: true } } },
      });

      return res.json({ data: groups.map(shapeGroup), total: groups.length });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ groups list error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * GET /settings/groups/:id
 * (admin/manager/agent/viewer) - detalhes de 1 grupo (com count)
 */
router.get(
  "/:id",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const group = await prisma.group.findFirst({
        where: { id, tenantId },
        include: { _count: { select: { members: true } } },
      });

      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      return res.json({ group: shapeGroup(group) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group get error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /settings/groups
 * (admin/manager) - cria grupo no tenant
 * body: { name }
 */
router.post(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const name = String(req.body?.name || "").trim();
      if (!name) return res.status(400).json({ error: "Nome é obrigatório." });

      const created = await prisma.group.create({
        data: {
          tenantId,
          name,
          isActive: true,
        },
        include: { _count: { select: { members: true } } },
      });

      return res.status(201).json({ success: true, group: shapeGroup(created) });
    } catch (e) {
      // unique([tenantId, name]) -> P2002
      if (String(e?.code || "") === "P2002") {
        return res.status(409).json({ error: "Já existe um grupo com esse nome neste tenant." });
      }
      logger.error({ err: e?.message || e }, "❌ group create error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /settings/groups/:id
 * (admin/manager) - edita nome e/ou isActive
 * body: { name?, isActive? }
 */
router.patch(
  "/:id",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const group = await prisma.group.findFirst({ where: { id, tenantId } });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      const data = {};
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
        const name = String(req.body?.name || "").trim();
        if (!name) return res.status(400).json({ error: "Nome inválido." });
        data.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
        const parsed = parseBoolean(req.body?.isActive);
        if (parsed === undefined) return res.status(400).json({ error: "isActive inválido (use true/false)." });
        data.isActive = parsed;
      }

      const updated = await prisma.group.update({
        where: { id: group.id },
        data,
        include: { _count: { select: { members: true } } },
      });

      return res.json({ success: true, group: shapeGroup(updated) });
    } catch (e) {
      if (String(e?.code || "") === "P2002") {
        return res.status(409).json({ error: "Já existe um grupo com esse nome neste tenant." });
      }
      logger.error({ err: e?.message || e }, "❌ group patch error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /settings/groups/:id/deactivate
 * (admin/manager) - desativa grupo
 */
router.patch(
  "/:id/deactivate",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const group = await prisma.group.findFirst({ where: { id, tenantId } });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      const updated = await prisma.group.update({
        where: { id: group.id },
        data: { isActive: false },
        include: { _count: { select: { members: true } } },
      });

      return res.json({ success: true, group: shapeGroup(updated) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group deactivate error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /settings/groups/:id/activate
 * (admin/manager) - reativa grupo
 */
router.patch(
  "/:id/activate",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const group = await prisma.group.findFirst({ where: { id, tenantId } });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      const updated = await prisma.group.update({
        where: { id: group.id },
        data: { isActive: true },
        include: { _count: { select: { members: true } } },
      });

      return res.json({ success: true, group: shapeGroup(updated) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group activate error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * GET /settings/groups/:id/members
 * (admin/manager/agent/viewer) - lista membros do grupo
 */
router.get(
  "/:id/members",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const groupId = String(req.params.id || "").trim();
      if (!groupId) return res.status(400).json({ error: "ID inválido." });

      const group = await prisma.group.findFirst({ where: { id: groupId, tenantId } });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      const members = await prisma.groupMember.findMany({
        where: { tenantId, groupId },
        include: { user: true },
        orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      });

      return res.json({ data: members.map(shapeMember), total: members.length });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group members list error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /settings/groups/:id/members
 * (admin/manager) - adiciona membro ao grupo
 * body: { userId, role? }
 */
router.post(
  "/:id/members",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const groupId = String(req.params.id || "").trim();
      if (!groupId) return res.status(400).json({ error: "ID inválido." });

      const userId = String(req.body?.userId || "").trim();
      const role = String(req.body?.role || "member").trim().toLowerCase(); // member | admin
      if (!userId) return res.status(400).json({ error: "userId é obrigatório." });
      if (!["member", "admin"].includes(role)) return res.status(400).json({ error: "role inválida (member|admin)." });

      // grupo do tenant
      const group = await prisma.group.findFirst({ where: { id: groupId, tenantId } });
      if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

      // usuário precisa existir e estar no tenant
      const membership = await prisma.userTenant.findUnique({
        where: { userId_tenantId: { userId, tenantId } },
        select: { isActive: true },
      });
      if (!membership || membership.isActive === false) {
        return res.status(400).json({ error: "Usuário não pertence ao tenant ou está inativo." });
      }

      const created = await prisma.groupMember.create({
        data: { tenantId, groupId, userId, role, isActive: true },
        include: { user: true },
      });

      return res.status(201).json({ success: true, member: shapeMember(created) });
    } catch (e) {
      if (String(e?.code || "") === "P2002") {
        return res.status(409).json({ error: "Usuário já está neste grupo." });
      }
      logger.error({ err: e?.message || e }, "❌ group member create error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /settings/groups/:id/members/:memberId
 * (admin/manager) - edita role/isActive do membro
 * body: { role?, isActive? }
 */
router.patch(
  "/:id/members/:memberId",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const groupId = String(req.params.id || "").trim();
      const memberId = String(req.params.memberId || "").trim();
      if (!groupId || !memberId) return res.status(400).json({ error: "ID inválido." });

      const member = await prisma.groupMember.findFirst({
        where: { id: memberId, tenantId, groupId },
        include: { user: true },
      });
      if (!member) return res.status(404).json({ error: "Membro não encontrado." });

      const data = {};

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "role")) {
        const role = String(req.body?.role || "").trim().toLowerCase();
        if (!["member", "admin"].includes(role)) return res.status(400).json({ error: "role inválida (member|admin)." });
        data.role = role;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
        const parsed = parseBoolean(req.body?.isActive);
        if (parsed === undefined) return res.status(400).json({ error: "isActive inválido (use true/false)." });
        data.isActive = parsed;
      }

      const updated = await prisma.groupMember.update({
        where: { id: member.id },
        data,
        include: { user: true },
      });

      return res.json({ success: true, member: shapeMember(updated) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group member patch error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * DELETE /settings/groups/:id/members/:memberId
 * (admin/manager) - remove membro do grupo (delete físico)
 */
router.delete(
  "/:id/members/:memberId",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const groupId = String(req.params.id || "").trim();
      const memberId = String(req.params.memberId || "").trim();
      if (!groupId || !memberId) return res.status(400).json({ error: "ID inválido." });

      const member = await prisma.groupMember.findFirst({
        where: { id: memberId, tenantId, groupId },
      });
      if (!member) return res.status(404).json({ error: "Membro não encontrado." });

      await prisma.groupMember.delete({ where: { id: member.id } });

      return res.json({ success: true });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ group member delete error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
