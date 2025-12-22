// backend/src/human/humanRouter.js
import express from "express";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";

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

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

function metaGet(row) {
  return asJson(row?.metadata);
}

function metaSet(row, patch) {
  const curr = metaGet(row);
  return { ...curr, ...asJson(patch) };
}

function normalizeConvRow(convRow) {
  if (!convRow) return null;

  const m = metaGet(convRow);

  const createdAt = convRow.createdAt ? new Date(convRow.createdAt).toISOString() : nowIso();
  const updatedAt = convRow.updatedAt ? new Date(convRow.updatedAt).toISOString() : createdAt;

  const status = String(convRow.status || "open").toLowerCase() === "closed" ? "closed" : "open";

  const source = String(m.source || convRow.channel || "whatsapp").toLowerCase();
  const channel = String(convRow.channel || m.channel || source || "whatsapp").toLowerCase();

  const currentMode = String(m.currentMode || "bot").toLowerCase();
  const handoffActive = Boolean(m.handoffActive);
  const hadHuman = Boolean(m.hadHuman);

  let inboxVisible = m.inboxVisible;
  if (typeof inboxVisible !== "boolean") {
    inboxVisible = currentMode === "human" || hadHuman === true || handoffActive === true;
  }

  const inboxStatus = String(
    m.inboxStatus || (inboxVisible ? "waiting_human" : "bot_only")
  );

  const queuedAt =
    inboxVisible === true
      ? (m.queuedAt || m.handoffSince || updatedAt)
      : null;

  return {
    // base
    id: String(convRow.id),
    tenantId: String(convRow.tenantId),
    contactId: String(convRow.contactId),
    status,

    // compat legado
    source,
    channel,
    peerId: String(m.peerId || ""),
    title: String(m.title || "Contato"),

    currentMode,
    handoffActive,
    handoffSince: m.handoffSince || null,
    handoffReason: m.handoffReason || null,
    hadHuman: Boolean(m.hadHuman),
    botAttempts: Number(m.botAttempts || 0),

    inboxVisible: Boolean(inboxVisible),
    inboxStatus,
    queuedAt,

    assignedGroupId: m.assignedGroupId ? String(m.assignedGroupId) : null,
    assignedUserId: m.assignedUserId ? String(m.assignedUserId) : null,

    claimedAt: m.claimedAt || null,
    claimedById: m.claimedById || null,
    claimedByName: m.claimedByName || null,

    releasedAt: m.releasedAt || null,

    closedAt: m.closedAt || null,
    closedById: m.closedById || null,
    closedByName: m.closedByName || null,

    createdAt,
    updatedAt,
    lastMessageAt: convRow.lastMessageAt ? new Date(convRow.lastMessageAt).toISOString() : (m.lastMessageAt || null),
    lastMessagePreview: String(m.lastMessagePreview || "")
  };
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
 * Lista fila de conversas (Prisma)
 * - waiting_human
 * - inboxVisible true
 * - open
 * - sem assignedUserId
 */
async function listQueueConversations({ tenantId, groupId, limit = 50 }) {
  const rows = await prisma.conversation.findMany({
    where: {
      tenantId,
      status: "open"
    },
    orderBy: { updatedAt: "asc" }, // depois reordenamos por queuedAt
    take: Math.min(Math.max(1, Number(limit) || 50), 200)
  });

  let items = rows.map(normalizeConvRow).filter(Boolean);

  items = items.filter((c) => {
    if (c.status !== "open") return false;
    if (c.inboxVisible !== true) return false;
    if (String(c.inboxStatus || "") !== "waiting_human") return false;

    if (groupId && String(c.assignedGroupId || "") !== String(groupId)) return false;

    if (c.assignedUserId) return false;

    return true;
  });

  items.sort((a, b) => {
    const ta = new Date(a.queuedAt || a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.queuedAt || b.updatedAt || b.createdAt || 0).getTime();
    return ta - tb; // mais antigo primeiro
  });

  return items;
}

/**
 * Conta chats ativos do agente (Prisma)
 * Critérios:
 * - open
 * - assignedUserId = agent
 * - currentMode=human
 * - opcional groupId
 */
async function countActiveChatsForAgent({ tenantId, agentId, groupId }) {
  const rows = await prisma.conversation.findMany({
    where: { tenantId, status: "open" },
    select: { id: true, metadata: true }
  });

  let n = 0;

  for (const r of rows) {
    const m = metaGet(r);
    const assignedUserId = m.assignedUserId ? String(m.assignedUserId) : "";
    if (assignedUserId !== String(agentId)) continue;

    if (groupId) {
      const assignedGroupId = m.assignedGroupId ? String(m.assignedGroupId) : "";
      if (assignedGroupId !== String(groupId)) continue;
    }

    const mode = String(m.currentMode || "").toLowerCase();
    if (mode !== "human") continue;

    n++;
  }

  return n;
}

/**
 * Claim atômico via updateMany (evita 2 agentes pegarem o mesmo chat)
 */
async function claimConversationAtomic({ tenantId, conversationId, me, groupId }) {
  const now = nowIso();

  // Primeiro lê (pra montar o metadata final e checar estado)
  const conv = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId, status: "open" }
  });
  if (!conv) return { ok: false, status: 404, error: "conversation_not_found" };

  const m = metaGet(conv);

  // precisa estar na inbox
  const inboxVisible =
    typeof m.inboxVisible === "boolean"
      ? m.inboxVisible
      : (String(m.currentMode || "bot").toLowerCase() === "human" || Boolean(m.handoffActive) || Boolean(m.hadHuman));

  if (!inboxVisible) return { ok: false, status: 409, error: "conversation_not_in_inbox" };

  // precisa estar esperando humano
  const inboxStatus = String(m.inboxStatus || (inboxVisible ? "waiting_human" : "bot_only"));
  if (inboxStatus !== "waiting_human") {
    return { ok: false, status: 409, error: "conversation_not_available" };
  }

  // se groupId foi pedido, conversa tem que ser do grupo (ou ainda não ter e receber agora)
  const currentGroupId = m.assignedGroupId ? String(m.assignedGroupId) : "";
  if (groupId && currentGroupId && currentGroupId !== String(groupId)) {
    return { ok: false, status: 409, error: "conversation_not_in_this_group" };
  }

  // não pode já estar atribuída
  if (m.assignedUserId) return { ok: false, status: 409, error: "already_claimed" };

  const patch = {
    // mantém compat legado
    currentMode: "human",
    hadHuman: true,
    handoffActive: true,
    handoffSince: m.handoffSince || now,

    assignedGroupId: groupId || currentGroupId || null,
    assignedUserId: me.id,

    inboxVisible: true,
    inboxStatus: "in_progress",

    claimedAt: now,
    claimedById: me.id,
    claimedByName: me.name
  };

  // updateMany serve como “compare-and-set”:
  // só atualiza se ainda não tem assignedUserId e ainda está waiting_human
  const updated = await prisma.conversation.updateMany({
    where: {
      id: conversationId,
      tenantId,
      status: "open",
      metadata: {
        path: ["assignedUserId"],
        equals: null
      }
    },
    data: {
      metadata: metaSet(conv, patch)
    }
  });

  if (updated.count !== 1) {
    return { ok: false, status: 409, error: "conversation_not_available" };
  }

  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId } });
  return { ok: true, conversation: normalizeConvRow(fresh) };
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

    const q = await listQueueConversations({ tenantId, groupId, limit });
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

    const membership = await assertGroupMembership({ tenantId, groupId, userId: me.id });
    if (!membership.ok) return res.status(membership.status).json({ error: membership.error });

    const maxChats = Math.max(1, Number(membership.group.maxChatsPerAgent || 1));

    const myActive = await countActiveChatsForAgent({ tenantId, agentId: me.id, groupId });
    if (myActive >= maxChats) {
      return res.status(409).json({
        error: "agent_at_capacity",
        details: { myActive, maxChats }
      });
    }

    const queue = await listQueueConversations({ tenantId, groupId, limit: 50 });
    const nextConv = queue[0] || null;

    if (!nextConv) {
      return res.status(404).json({ error: "queue_empty" });
    }

    const claimed = await claimConversationAtomic({
      tenantId,
      conversationId: nextConv.id,
      me,
      groupId
    });

    if (!claimed.ok) return res.status(claimed.status).json({ error: claimed.error });

    return res.status(200).json({
      ok: true,
      conversation: claimed.conversation,
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

    const myActive = await countActiveChatsForAgent({ tenantId, agentId: me.id, groupId });
    if (myActive >= maxChats) {
      return res.status(409).json({ error: "agent_at_capacity", details: { myActive, maxChats } });
    }

    const claimed = await claimConversationAtomic({
      tenantId,
      conversationId,
      me,
      groupId
    });

    if (!claimed.ok) return res.status(claimed.status).json({ error: claimed.error });

    return res.json({
      ok: true,
      conversation: claimed.conversation,
      capacity: { myActive: myActive + 1, maxChats }
    });
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

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, status: "open" }
    });
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    const m = metaGet(conv);
    if (String(m.assignedUserId || "") !== String(me.id)) {
      return res.status(403).json({ error: "not_owner" });
    }

    const patch = {
      assignedUserId: null,
      inboxStatus: "waiting_human",
      releasedAt: nowIso()
    };

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        metadata: metaSet(conv, patch)
      }
    });

    return res.json({ ok: true, conversation: normalizeConvRow(updated) });
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

    const conv = await prisma.conversation.findFirst({
      where: { id: conversationId, tenantId, status: "open" }
    });
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });

    const m = metaGet(conv);
    if (String(m.assignedUserId || "") !== String(me.id)) {
      return res.status(403).json({ error: "not_owner" });
    }

    const now = nowIso();
    const patch = {
      inboxStatus: "closed",
      closedAt: now,
      closedById: me.id,
      closedByName: me.name
    };

    const updated = await prisma.conversation.update({
      where: { id: conv.id },
      data: {
        status: "closed",
        metadata: metaSet(conv, patch)
      }
    });

    return res.json({ ok: true, conversation: normalizeConvRow(updated) });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ human close error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
