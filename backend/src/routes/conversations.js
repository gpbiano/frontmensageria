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
  if (!Array.isArray(db.messagesByConversation[key])) {
    db.messagesByConversation[key] = [];
  }
  return db.messagesByConversation[key];
}

// ======================================================
// NORMALIZA CONVERSA (handoff tradicional)
// ======================================================
function normalizeConversation(conv) {
  if (!conv) return conv;

  conv.id = String(conv.id || "");
  conv.source = String(conv.source || conv.channel || "whatsapp").toLowerCase();
  conv.channel = String(conv.channel || conv.source || "whatsapp").toLowerCase();

  conv.status = conv.status === "closed" ? "closed" : "open";

  if (!conv.createdAt) conv.createdAt = nowIso();
  if (!conv.updatedAt) conv.updatedAt = conv.createdAt;

  conv.currentMode = conv.currentMode || "bot";
  conv.botAttempts = Number(conv.botAttempts || 0);
  conv.hadHuman = Boolean(conv.hadHuman);

  conv.handoffActive = Boolean(conv.handoffActive);
  if (conv.handoffActive && !conv.handoffSince) {
    conv.handoffSince = conv.updatedAt || conv.createdAt;
  }

  conv.peerId = String(conv.peerId || "");

  conv.lastMessagePreview = String(conv.lastMessagePreview || "");
  conv.lastMessageAt = conv.lastMessageAt || null;

  // 🔑 REGRA DE OURO DO PAINEL
  if (typeof conv.inboxVisible !== "boolean") {
    conv.inboxVisible =
      conv.currentMode === "human" ||
      conv.hadHuman === true ||
      conv.handoffActive === true;
  }

  conv.inboxStatus =
    conv.inboxVisible === true ? "waiting_human" : "bot_only";

  conv.queuedAt =
    conv.inboxVisible === true
      ? conv.queuedAt || conv.handoffSince || conv.updatedAt
      : null;

  return conv;
}

// ======================================================
// NORMALIZA MENSAGEM
// ======================================================
function normalizeMsg(conv, raw) {
  const createdAt = raw.createdAt || raw.timestamp || nowIso();
  const type = String(raw.type || "text").toLowerCase();

  const text =
    typeof raw.text === "string"
      ? raw.text
      : typeof raw.text?.body === "string"
      ? raw.text.body
      : "";

  let from = raw.from || null;
  let direction = raw.direction || null;

  if (from === "user" || from === "visitor") from = "client";
  if (from === "human" || from === "attendant") from = "agent";

  const isBot = raw.isBot === true || from === "bot";

  if (!direction) direction = from === "client" ? "in" : "out";
  if (!from) from = direction === "in" ? "client" : "agent";

  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || newId("msg"),
    conversationId: conv.id,
    channel: raw.channel || conv.channel,
    source: raw.source || conv.source,
    type,
    from,
    direction,
    isBot,
    text,
    createdAt,
    waMessageId: raw.waMessageId,
    payload: raw.payload,
    delivery: raw.delivery,
    tenantId: raw.tenantId || conv.tenantId
  };
}

// ======================================================
// ATUALIZA METADADOS DA CONVERSA
// ======================================================
function touchConversation(conv, msg) {
  const at = nowIso();
  conv.updatedAt = at;
  conv.lastMessageAt = at;
  conv.lastMessagePreview = String(msg.text || "").slice(0, 120);
}

// ======================================================
// PROMOVE PARA INBOX (handoff real)
// ======================================================
function promoteToInbox(conv, reason = "handoff") {
  conv.currentMode = "human";
  conv.hadHuman = true;
  conv.handoffActive = true;
  conv.handoffSince = conv.handoffSince || nowIso();

  conv.inboxVisible = true;
  conv.inboxStatus = "waiting_human";
  conv.queuedAt = conv.queuedAt || nowIso();
  conv.handoffReason = reason;
}

// ======================================================
// CORE EXPORTS (usados por WhatsApp / Webchat)
// ======================================================
export function getOrCreateChannelConversation(db, payload) {
  db = ensureDbShape(db);

  const source = String(payload.source || "").toLowerCase();
  const peerId = String(payload.peerId || "").trim();
  if (!source || !peerId) {
    return { ok: false, error: "source e peerId obrigatórios" };
  }

  let conv = db.conversations.find(
    (c) =>
      c.status === "open" &&
      c.source === source &&
      c.peerId === peerId
  );

  if (!conv) {
    conv = {
      id: newId(source === "whatsapp" ? "wa" : "wc"),
      source,
      channel: source,
      peerId,
      title: payload.title || "Contato",
      status: "open",

      currentMode: payload.currentMode || "bot",
      hadHuman: false,
      botAttempts: 0,

      handoffActive: false,
      handoffSince: null,
      handoffReason: null,

      phone: payload.phone || null,
      waId: payload.waId || null,
      visitorId: payload.visitorId || null,
      tenantId: payload.tenantId || null,

      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastMessageAt: null,
      lastMessagePreview: "",

      inboxVisible: false,
      inboxStatus: "bot_only",
      queuedAt: null
    };

    db.conversations.push(conv);
    ensureConversationMessages(db, conv.id);
  }

  normalizeConversation(conv);
  return { ok: true, conversation: conv };
}

export function appendMessage(db, conversationId, rawMsg) {
  db = ensureDbShape(db);

  const conv = db.conversations.find((c) => c.id === conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  normalizeConversation(conv);

  const list = ensureConversationMessages(db, conv.id);
  const msg = normalizeMsg(conv, rawMsg);

  // dedupe WhatsApp
  if (
    msg.waMessageId &&
    list.some((m) => m.waMessageId === msg.waMessageId)
  ) {
    return { ok: true, msg, duplicated: true };
  }

  list.push(msg);

  if (msg.from === "bot") {
    conv.botAttempts++;
    conv.currentMode = "bot";
  }

  if (msg.from === "agent" || rawMsg?.handoff === true) {
    promoteToInbox(conv, "agent_message");
  }

  touchConversation(conv, msg);
  return { ok: true, msg };
}

// ======================================================
// ROTAS DO PAINEL
// ======================================================

// GET /conversations
// padrão: só inbox humano
router.get("/", (req, res) => {
  const db = ensureDbShape(loadDB());
  let items = ensureArray(db.conversations);
  items.forEach(normalizeConversation);

  if (req.query.inbox !== "all") {
    items = items.filter((c) => c.inboxVisible === true);
  }

  items.sort(
    (a, b) =>
      new Date(b.queuedAt || b.updatedAt).getTime() -
      new Date(a.queuedAt || a.updatedAt).getTime()
  );

  res.json(items);
});

// GET /conversations/:id/messages
router.get("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = db.conversations.find((c) => c.id === req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, conv.id);
  res.json(list);
});

// POST /conversations/:id/messages (humano)
router.post("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const r = appendMessage(db, req.params.id, {
    ...req.body,
    from: "agent",
    direction: "out",
    createdAt: nowIso()
  });

  if (!r.ok) return res.status(400).json({ error: r.error });
  saveDB(db);
  res.status(201).json(r.msg);
});

export default router;
