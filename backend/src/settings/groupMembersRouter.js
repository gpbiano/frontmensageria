// backend/src/settings/groupMembersRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Rotas de membros do grupo (settings)
// Base: /settings/groups/:id/members

import express from "express";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router({ mergeParams: true });

function nowIso() {
  return new Date().toISOString();
}

function normalizeRole(role) {
  // ✅ schema atual: GroupMember.role = "member" | "admin"
  // compat antigo: manager/agent -> admin/member
  const v = String(role || "").trim().toLowerCase();
  if (!v) return "member";
  if (v === "admin") return "admin";
  if (v === "member") return "member";
  if (v === "manager") return "admin";
  if (v === "agent") return "member";
  return "member";
}

function getGroupId(req) {
  return String(req.params.id || req.params.groupId || "").trim() || null;
}

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

async function assertGroupInTenant({ tenantId, groupId }) {
  const group = await prisma.group.findFirst({
    where: { id: groupId, tenantId },
    select: { id: true, tenantId: true, name: true, isActive: true, maxChatsPerAgent: true }
  });
  if (!group) return { ok: false, status: 404, error: "group_not_found" };
  return { ok: true, group };
}

async function assertUserExists(userId) {
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { id: true, name: true, email: true, role: true, isActive: true }
  });
  if (!user) return { ok: false, status: 404, error: "user_not_found" };
  return { ok: true, user };
}

/**
 * GET /settings/groups/:id/members?includeInactive=true
 */
router.get("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const groupId = getGroupId(req);
    if (!groupId) return res.status(400).json({ error: "groupId inválido (param ausente)." });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const g = await assertGroupInTenant({ tenantId, groupId });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const includeInactive = String(req.query.includeInactive || "false") === "true";

    const members = await prisma.groupMember.findMany({
      where: {
        tenantId,
        groupId,
        ...(includeInactive ? {} : { isActive: true })
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      include: {
        user: { select: { id: true, name: true, email: true, role: true, isActive: true } }
      }
    });

    const items = members.map((m) => ({
      id: m.id,
      groupId: m.groupId,
      userId: m.userId,
      memberRole: m.role || "member",
      isActive: m.isActive !== false,
      createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : nowIso(),
      updatedAt: m.updatedAt ? new Date(m.updatedAt).toISOString() : nowIso(),

      name: m.user?.name || "Usuário removido",
      email: m.user?.email || "",
      userRole: m.user?.role || "agent",
      userIsActive: m.user?.isActive !== false
    }));

    return res.json({
      items,
      total: items.length,
      group: {
        id: g.group.id,
        name: g.group.name,
        tenantId: g.group.tenantId,
        isActive: g.group.isActive !== false,
        maxChatsPerAgent: g.group.maxChatsPerAgent
      }
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ groupMembersRouter GET / failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /settings/groups/:id/members
 * Body: { userId, role }
 */
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const groupId = getGroupId(req);
    if (!groupId) return res.status(400).json({ error: "groupId inválido (param ausente)." });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const g = await assertGroupInTenant({ tenantId, groupId });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const userId = req.body?.userId;
    if (userId === undefined || userId === null || String(userId).trim() === "") {
      return res.status(400).json({ error: "userId é obrigatório." });
    }

    const u = await assertUserExists(String(userId).trim());
    if (!u.ok) return res.status(u.status).json({ error: u.error });

    const role = normalizeRole(req.body?.role);

    // ✅ garante que não vai “misturar tenant” em um user de outro tenant via membership
    // (se no futuro você travar usuário por tenant, coloque a checagem aqui)

    const member = await prisma.groupMember.upsert({
      where: {
        tenantId_groupId_userId: {
          tenantId,
          groupId,
          userId: u.user.id
        }
      },
      create: {
        tenantId,
        groupId,
        userId: u.user.id,
        role,
        isActive: true
      },
      update: {
        role,
        isActive: true
      }
    });

    // 201 quando cria, 200 quando atualiza (melhor sem quebrar frontend)
    // Se quiser manter simples, retorna sempre 201 como antes.
    return res.status(201).json({
      success: true,
      member,
      user: { id: u.user.id, name: u.user.name, email: u.user.email, role: u.user.role }
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ groupMembersRouter POST / failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/groups/:id/members/:userId
 * Body: { role?, isActive? }
 */
router.patch("/:userId", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const groupId = getGroupId(req);
    if (!groupId) return res.status(400).json({ error: "groupId inválido (param ausente)." });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const g = await assertGroupInTenant({ tenantId, groupId });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "userId inválido (param ausente)." });

    const existing = await prisma.groupMember.findFirst({
      where: { tenantId, groupId, userId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ error: "member_not_found" });

    const data = {};
    if (req.body?.role !== undefined) data.role = normalizeRole(req.body.role);
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;

    if (!Object.keys(data).length) {
      return res.status(400).json({ error: "no_fields_to_update" });
    }

    const member = await prisma.groupMember.update({
      where: { id: existing.id },
      data
    });

    return res.json({ success: true, member });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ groupMembersRouter PATCH /:userId failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/groups/:id/members/:userId/deactivate
 */
router.patch("/:userId/deactivate", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const groupId = getGroupId(req);
    if (!groupId) return res.status(400).json({ error: "groupId inválido (param ausente)." });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const g = await assertGroupInTenant({ tenantId, groupId });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "userId inválido (param ausente)." });

    const existing = await prisma.groupMember.findFirst({
      where: { tenantId, groupId, userId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ error: "member_not_found" });

    const member = await prisma.groupMember.update({
      where: { id: existing.id },
      data: { isActive: false }
    });

    return res.json({ success: true, member });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ groupMembersRouter PATCH deactivate failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/groups/:id/members/:userId/activate
 * Body: { role? }
 */
router.patch("/:userId/activate", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const groupId = getGroupId(req);
    if (!groupId) return res.status(400).json({ error: "groupId inválido (param ausente)." });

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const g = await assertGroupInTenant({ tenantId, groupId });
    if (!g.ok) return res.status(g.status).json({ error: g.error });

    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "userId inválido (param ausente)." });

    const existing = await prisma.groupMember.findFirst({
      where: { tenantId, groupId, userId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ error: "member_not_found" });

    const data = { isActive: true };
    if (req.body?.role !== undefined) data.role = normalizeRole(req.body.role);

    const member = await prisma.groupMember.update({
      where: { id: existing.id },
      data
    });

    return res.json({ success: true, member });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ groupMembersRouter PATCH activate failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
