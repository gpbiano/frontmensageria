// backend/src/human/humanRouter.js
import express from "express";
import logger from "../logger.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { prisma } from "../lib/prisma.js"; // ajuste se no seu projeto for default export

const router = express.Router();

/**
 * ======================================================
 * HELPERS
 * ======================================================
 */

function nowIso() {
  return new Date().toISOString();
}

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId || req.user?.tenantId;
  return tenantId ? String(tenantId) : null;
}

function getUserFromReq(req) {
  const u = req.user || {};
  return {
    id: String(u.id || u.userId || ""),
    name: u.name || u.fullName || u.email || "Atendente",
    role: u.role || "agent",
    email: u.email || null
  };
}

function ensureDbShape(db) {
  if (!db || typeof db !== "object") db = {};
  db.conversations = ensureArray(db.conversations);
  db.messagesByConversation =
    db.messagesByConversation && typeof db.messagesByConversation === "object"
      ? db.messagesByConversation
      : {};
  return db;
}

function normalizeConv(conv) {
  if (!conv) return conv;

  conv.id = String(conv.id || "");
  conv.status = String(conv.status || "open").toLowerCase() === "closed" ? "closed" : "open";
  conv.source = String(conv.source || conv.channel || "whatsapp").toLowerCase();
  conv.channel = String(conv.channel || conv.source || "whatsapp").toLowerCase();

  conv.currentMode = String(conv.currentMode || "bot").toLowerCase();
  conv.handoffActive = !!conv.handoffActive;
  conv.inboxVisible = !!conv.inboxVisible;

  conv.inboxStatus = String(conv.inboxStatus || (conv.inboxVisible ? "waiting_human" : "bot_only"));
  conv.updatedAt = conv.updatedAt || conv.createdAt || nowIso();
  conv.createdAt = conv.createdAt || nowIso();
  conv.queuedAt = conv.queuedAt || (conv.inboxVisible ? (conv.handoffSince || conv.updatedAt) : null);

  conv.assignedGroupId = conv.assignedGroupId ? String(conv.assignedGroupId) : null;
  conv.assignedUserId = conv.assignedUserId ? String(conv.assignedUserId) : null;

  return conv;
}

function listQueueConversations(db, { tenantId, groupId }) {
  db = ensureDbShape(db);
  const items = db.conversations.map(normalizeConv);

  return items
    .filter((c) => {
      // apenas conversas em handoff / fila humana
      if (c.status !== "open") return false;
      if (c.inboxVisible !== true) return false;
      if (String(c.inboxStatus || "") !== "waiting_human") return false;

      // tenant guard (se existir)
      if (tenantId && c.tenantId && String(c.tenantId) !== String(tenantId)) return false;

      // grupo
      if (groupId && String(c.assignedGroupId || "") !== String(groupId)) return false;

      // ainda não atribuída a um agente
      if (c.assignedUserId) return false;

      return true;
    })
    .sort((a, b) => {
      const ta = new Date(a.queuedAt || a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.queuedAt || b.updatedAt || b.createdAt || 0).getTime();
      return ta - tb; // mais antigo primeiro
    });
}

function countActiveChatsForAgent(db, { tenantId, agentId, groupId }) {
  db = ensureDbShape(db);
  const items = db.conversations.map(normalizeConv);

  return items.filter((c) => {
    if (c.status !== "open") return false;

    // tenant guard (se existir)
    if (tenantId && c.tenantId && String(c.tenantId) !== String(tenantId)) return false;

    // precisa estar atribuído ao agente
    if (String(c.assignedUserId || "") !== String(agentId)) return false;

    // se quiser limitar por grupo, filtra
    if (groupId && String(c.assignedGroupId || "") !== String(groupId)) return false;

    // só conta atendimentos humanos (em progresso)
    const mode = String(c.currentMode || "").toLowerCase();
    if (mode !== "human") return false;

    // não pode estar encerrada
    return true;
  }).length;
}

/**
 * Valida se o usuário é membro ativo do grupo no tenant
 */
async function assertGroupMembership({ tenantId, groupId, userId }) {
  const group = await prisma.group.findFirst({
    where: { id: groupId, tenantId, isActive: true },
    select: { id: true, maxChatsPerAgent: true }
  });

  if (!group) return { ok: false, status: 404, error: "group_not_found_or_inactive" };

  const member = await prisma.groupMember.findFirst({
    where: { tenantId, groupId, userId, isActive: true },
    select: { id: true, role: true }
  });

  if (!member) return { ok: false, status: 403, error: "user_not_in_group" };

  return {
    ok: true,
    group: { id: group.id, maxChatsPerAgent: Number(group.maxChatsPerAgent || 0) },
    member
  };
}

/**
 * ======================================================
 * ROUTES
 * ======================================================
 */

// Ping
router.get("/", (req, res) => {
  res.json({ status: "ok", message: "Human module online (queue mode)." });
});

/**
 * GET /api/human/queue
 * Lista fila de um grupo (ou de todos)
 * query: groupId? , limit?
 */
router.get("/queue", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const groupId = req.query.groupId ? String(req.query.groupId) : null;
    const limit = Math.min(Number(req.query.limit || 50) || 50, 200);

    // se passar groupId, valida que o usuário pertence ao grupo
    if (groupId) {
      const me = getUserFromReq(req);
      const membership = await assertGroupMembership({ tenantId, groupId, userId: me.id });
      if (!membership.ok) return res.status(membership.status).json({ error: membership.error });
    }

    const db = ensureDbShape(loadDB());
    const q = listQueueConversations(db, { tenantId, groupId }).slice(0, limit);

    return res.json({ data: q, total: q.length });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human queue list error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/human/queue/next
 * "Puxa" o próximo chat da fila do grupo e atribui ao agente
 * body: { groupId }
 */
router.post("/queue/next", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const groupId = String(req.body?.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId_required" });

    const me = getUserFromReq(req);
    if (!me.id) return res.status(401).json({ error: "unauthorized" });

    // valida grupo + membership + pega limite
    const membership = await assertGroupMembership({ tenantId, groupId, userId: me.id });
    if (!membership.ok) return res.status(membership.status).json({ error: membership.error });

    const maxChats = Math.max(1, Number(membership.group.maxChatsPerAgent || 1));

    const db = ensureDbShape(loadDB());

    // respeita limite
    const myActive = countActiveChatsForAgent(db, { tenantId, agentId: me.id, groupId });
    if (myActive >= maxChats) {
      return res.status(409).json({
        error: "agent_at_capacity",
        details: { myActive, maxChats }
      });
    }

    // pega próximo da fila
    const queue = listQueueConversations(db, { tenantId, groupId });
    const nextConv = queue[0] || null;

    if (!nextConv) {
      return res.status(404).json({ error: "queue_empty" });
    }

    // claim
    const conv = db.conversations.find((c) => String(c.id) === String(nextConv.id));
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    normalizeConv(conv);

    // revalida que ainda está disponível
    if (conv.inboxStatus !== "waiting_human" || conv.inboxVisible !== true || conv.assignedUserId) {
      saveDB(db);
      return res.status(409).json({ error: "conversation_not_available" });
    }

    conv.currentMode = "human";
    conv.handoffActive = true;
    conv.handoffSince = conv.handoffSince || nowIso();

    conv.assignedGroupId = groupId;
    conv.assignedUserId = me.id;

    conv.inboxVisible = true;
    conv.inboxStatus = "in_progress";
    conv.claimedAt = nowIso();
    conv.claimedById = me.id;
    conv.claimedByName = me.name;

    conv.updatedAt = nowIso();

    saveDB(db);

    return res.status(200).json({
      ok: true,
      conversation: conv,
      capacity: { myActive: myActive + 1, maxChats }
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human queue next error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/human/conversations/:id/claim
 * Força claim manual (ex: clique no painel)
 * body: { groupId }
 */
router.post("/conversations/:id/claim", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const conversationId = String(req.params.id || "").trim();
    if (!conversationId) return res.status(400).json({ error: "conversationId_required" });

    const groupId = String(req.body?.groupId || "").trim();
    if (!groupId) return res.status(400).json({ error: "groupId_required" });

    const me = getUserFromReq(req);
    if (!me.id) return res.status(401).json({ error: "unauthorized" });

    const membership = await assertGroupMembership({ tenantId, groupId, userId: me.id });
    if (!membership.ok) return res.status(membership.status).json({ error: membership.error });

    const maxChats = Math.max(1, Number(membership.group.maxChatsPerAgent || 1));

    const db = ensureDbShape(loadDB());

    const myActive = countActiveChatsForAgent(db, { tenantId, agentId: me.id, groupId });
    if (myActive >= maxChats) {
      return res.status(409).json({ error: "agent_at_capacity", details: { myActive, maxChats } });
    }

    const conv = db.conversations.find((c) => String(c.id) === String(conversationId));
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    normalizeConv(conv);

    // valida que é da fila e do grupo
    if (conv.status !== "open" || conv.inboxVisible !== true) {
      return res.status(409).json({ error: "conversation_not_in_inbox" });
    }
    if (String(conv.assignedGroupId || "") !== String(groupId)) {
      return res.status(409).json({ error: "conversation_not_in_this_group" });
    }
    if (conv.assignedUserId) {
      return res.status(409).json({ error: "already_claimed" });
    }

    conv.currentMode = "human";
    conv.handoffActive = true;
    conv.handoffSince = conv.handoffSince || nowIso();

    conv.assignedUserId = me.id;

    conv.inboxStatus = "in_progress";
    conv.claimedAt = nowIso();
    conv.claimedById = me.id;
    conv.claimedByName = me.name;

    conv.updatedAt = nowIso();

    saveDB(db);

    return res.json({ ok: true, conversation: conv, capacity: { myActive: myActive + 1, maxChats } });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human claim error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/human/conversations/:id/release
 * Solta o chat de volta para a fila (assignedUserId = null)
 */
router.post("/conversations/:id/release", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const conversationId = String(req.params.id || "").trim();
    if (!conversationId) return res.status(400).json({ error: "conversationId_required" });

    const me = getUserFromReq(req);
    if (!me.id) return res.status(401).json({ error: "unauthorized" });

    const db = ensureDbShape(loadDB());
    const conv = db.conversations.find((c) => String(c.id) === String(conversationId));
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    normalizeConv(conv);

    // tenant guard (se existir)
    if (conv.tenantId && String(conv.tenantId) !== String(tenantId)) {
      return res.status(403).json({ error: "forbidden_tenant" });
    }

    if (String(conv.assignedUserId || "") !== String(me.id)) {
      return res.status(403).json({ error: "not_owner" });
    }

    conv.assignedUserId = null;
    conv.inboxStatus = "waiting_human";
    conv.releasedAt = nowIso();
    conv.updatedAt = nowIso();

    saveDB(db);
    return res.json({ ok: true, conversation: conv });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human release error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /api/human/conversations/:id/close
 * Encerra atendimento humano (fecha a conversa)
 */
router.post("/conversations/:id/close", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const conversationId = String(req.params.id || "").trim();
    if (!conversationId) return res.status(400).json({ error: "conversationId_required" });

    const me = getUserFromReq(req);
    if (!me.id) return res.status(401).json({ error: "unauthorized" });

    const db = ensureDbShape(loadDB());
    const conv = db.conversations.find((c) => String(c.id) === String(conversationId));
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    normalizeConv(conv);

    if (conv.tenantId && String(conv.tenantId) !== String(tenantId)) {
      return res.status(403).json({ error: "forbidden_tenant" });
    }

    // só quem está com o chat pode fechar (simples e seguro)
    if (String(conv.assignedUserId || "") !== String(me.id)) {
      return res.status(403).json({ error: "not_owner" });
    }

    conv.status = "closed";
    conv.closedAt = nowIso();
    conv.closedById = me.id;
    conv.closedByName = me.name;

    conv.inboxStatus = "closed";
    conv.updatedAt = nowIso();

    saveDB(db);

    return res.json({ ok: true, conversation: conv });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human close error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
