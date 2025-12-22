import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

const router = express.Router();

// ======================================================
// HELPERS
// ======================================================
function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
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

function ensureConversationMessages(db, conversationId) {
  ensureDbShape(db);
  const key = String(conversationId);
  if (!Array.isArray(db.messagesByConversation[key])) db.messagesByConversation[key] = [];
  return db.messagesByConversation[key];
}

function normalizeConversation(conv) {
  if (!conv) return conv;

  conv.id = String(conv.id || "");
  conv.source = String(conv.source || conv.channel || "whatsapp").toLowerCase();
  conv.channel = String(conv.channel || conv.source || "whatsapp").toLowerCase();

  if (!conv.status) conv.status = "open";
  conv.status = String(conv.status).toLowerCase() === "closed" ? "closed" : "open";

  if (!conv.createdAt) conv.createdAt = nowIso();
  if (!conv.updatedAt) conv.updatedAt = conv.createdAt;

  if (!conv.currentMode) conv.currentMode = "bot";
  if (typeof conv.botAttempts !== "number") conv.botAttempts = Number(conv.botAttempts || 0);
  if (typeof conv.hadHuman !== "boolean") conv.hadHuman = Boolean(conv.hadHuman);

  if (!conv.peerId) conv.peerId = "";

  if (typeof conv.lastMessagePreview !== "string") conv.lastMessagePreview = "";
  if (!conv.lastMessageAt) conv.lastMessageAt = null;

  return conv;
}

function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeMsg(conv, raw) {
  const createdAt = raw.createdAt || raw.timestamp || raw.sentAt || nowIso();

  const type = String(raw.type || "text").toLowerCase();

  const extracted =
    raw?.text?.body ??
    raw?.text ??
    raw?.body ??
    raw?.message ??
    raw?.content ??
    raw?.caption ??
    "";

  const text = typeof extracted === "string" ? extracted : safeStringify(extracted);

  let from = raw.from || raw.sender || raw.author || null;
  let direction = raw.direction || null;

  if (from === "user" || from === "contact" || from === "visitor") from = "client";
  if (from === "attendant" || from === "human") from = "agent";

  const isBot = !!(raw.isBot || raw.fromBot || raw.bot === true || from === "bot");

  if (!direction) direction = from === "client" ? "in" : "out";
  if (!from) from = direction === "in" ? "client" : "agent";

  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || raw._id || newId("msg"),
    conversationId: String(raw.conversationId || conv.id),
    channel: raw.channel || conv.channel || conv.source || "whatsapp",
    source: raw.source || conv.source || raw.channel || "whatsapp",
    type,
    from,
    direction,
    isBot,
    isSystem: !!raw.isSystem,
    text: String(text || ""),
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt,
    senderName: raw.senderName || raw.byName || raw.agentName || undefined,
    waMessageId: raw.waMessageId || raw.messageId || raw.metaMessageId || undefined,
    delivery: raw.delivery || undefined,
    payload: raw.payload || undefined,
    tenantId: raw.tenantId || conv.tenantId || undefined,
  };
}

function touchConversation(conv, msg) {
  const at = nowIso();
  conv.updatedAt = at;
  conv.lastMessageAt = at;

  const preview = String(msg?.text || "").trim();
  conv.lastMessagePreview = preview ? preview.slice(0, 120) : (conv.lastMessagePreview || "");
}

// ======================================================
// ✅ CORE EXPORTS (O QUE O WHATSAPP + WEBCHAT PRECISAM)
// ======================================================

export function getOrCreateChannelConversation(db, payload) {
  db = ensureDbShape(db);

  const source = String(payload?.source || "").toLowerCase();
  if (!source) return { ok: false, error: "source obrigatório" };

  const peerId = String(payload?.peerId || "").trim();
  if (!peerId) return { ok: false, error: "peerId obrigatório" };

  const accountId = payload?.accountId ? String(payload.accountId) : null;

  let conv = db.conversations.find((c) => {
    normalizeConversation(c);
    return (
      c.status === "open" &&
      String(c.source || "") === source &&
      String(c.peerId || "") === peerId &&
      (accountId ? String(c.accountId || "") === accountId : true)
    );
  });

  if (!conv) {
    const idPrefix =
      source === "webchat" ? "wc" : source === "whatsapp" ? "wa" : "conv";

    conv = {
      id: newId(idPrefix),
      source,
      channel: source,
      peerId,
      title: payload?.title || "Contato",
      status: "open",

      currentMode: payload?.currentMode || "bot",
      hadHuman: false,
      botAttempts: 0,

      assignedGroupId: null,
      assignedUserId: null,

      tags: [],
      notes: "",

      accountId: accountId || null,
      channelId: payload?.channelId ? String(payload.channelId) : null,

      phone: payload?.phone || null,
      waId: payload?.waId || null,
      visitorId: payload?.visitorId || null,

      tenantId: payload?.tenantId || null,

      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastMessageAt: null,
      lastMessagePreview: "",
    };

    db.conversations.push(conv);
    ensureConversationMessages(db, conv.id);
  }

  normalizeConversation(conv);
  return { ok: true, conversation: conv };
}

export function appendMessage(db, conversationId, rawMsg) {
  db = ensureDbShape(db);

  const id = String(conversationId || "");
  const conv =
    db.conversations.find((c) => String(c?.id) === id) ||
    db.conversations.find((c) => String(c?.sessionId || "") === id) ||
    null;

  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  normalizeConversation(conv);

  const list = ensureConversationMessages(db, conv.id);
  const msg = normalizeMsg(conv, { ...rawMsg, conversationId: String(conv.id) });

  // dedupe por id
  if (msg.id && list.some((m) => String(m.id) === String(msg.id))) {
    return { ok: true, msg, duplicated: true };
  }
  // dedupe por waMessageId (quando existir)
  if (msg.waMessageId && list.some((m) => String(m.waMessageId || "") === String(msg.waMessageId))) {
    return { ok: true, msg, duplicated: true };
  }

  list.push(msg);

  // flags de modo
  if (msg.from === "bot" || msg.isBot) {
    conv.botAttempts = Number(conv.botAttempts || 0) + 1;
    conv.currentMode = "bot";
  }
  if (msg.from === "agent") {
    conv.hadHuman = true;
    conv.currentMode = "human";
  }

  touchConversation(conv, msg);
  return { ok: true, msg };
}

// ======================================================
// ROUTES (mantém pra painel/histórico)
// ======================================================

// GET /conversations
router.get("/", (req, res) => {
  const db = ensureDbShape(loadDB());
  const items = ensureArray(db.conversations);
  items.forEach(normalizeConversation);

  items.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return res.json(items);
});

// GET /conversations/:id/messages
router.get("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = db.conversations.find((c) => String(c?.id) === id) || null;
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, id).slice();
  list.sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );

  return res.json(list);
});

// POST /conversations/:id/messages (persistência local apenas)
router.post("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const r = appendMessage(db, id, {
    ...req.body,
    from: req.body?.from || "agent",
    direction: req.body?.direction || "out",
    createdAt: nowIso(),
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao salvar" });

  saveDB(db);
  return res.status(201).json(r.msg);
});

export default router;
