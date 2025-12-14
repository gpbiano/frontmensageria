// backend/src/routes/conversationsRouter.js
import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "msg") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureDbShape(db) {
  if (!db.conversations) db.conversations = [];
  if (!db.messagesByConversation || typeof db.messagesByConversation !== "object") {
    db.messagesByConversation = {};
  }
  return db;
}

function ensureMessagesByConversation(db) {
  ensureDbShape(db);
  return db.messagesByConversation;
}

function ensureConversationMessages(db, conversationId) {
  const map = ensureMessagesByConversation(db);
  const key = String(conversationId);
  if (!Array.isArray(map[key])) map[key] = [];
  return map[key];
}

function normalizeSourceFromChannel(ch) {
  if (!ch) return "";
  const v = String(ch).toLowerCase();
  if (v.includes("webchat")) return "webchat";
  if (v.includes("whatsapp")) return "whatsapp";
  if (v.includes("bot")) return "bot";
  if (v.includes("human")) return "human";
  return v;
}

/**
 * MODELO A: multi-canal paralelo
 * ✅ Nunca “mata” conversa de outro canal.
 * ✅ Toda conversa deve ter: source + peerId (ou pelo menos source)
 */
function normalizeConversation(conv) {
  if (!conv) return conv;
  if (!conv.source) conv.source = normalizeSourceFromChannel(conv.channel) || conv.source || "whatsapp";
  if (!conv.channel) conv.channel = conv.source;

  // peerId é opcional aqui (porque seu DB pode ter legado),
  // mas se faltar, tentamos derivar sem quebrar:
  if (!conv.peerId) {
    if (conv.source === "webchat" && conv.visitorId) conv.peerId = `wc:${conv.visitorId}`;
    if (conv.source === "whatsapp" && (conv.waId || conv.phone || conv.contactPhone)) {
      conv.peerId = `wa:${conv.waId || conv.phone || conv.contactPhone}`;
    }
  }
  return conv;
}

function getConversation(db, id) {
  const convs = ensureArray(db.conversations);
  const conv = convs.find((c) => String(c.id) === String(id));
  return conv ? normalizeConversation(conv) : null;
}

function normalizeMsg(conv, raw) {
  const createdAt = raw.createdAt || raw.timestamp || raw.sentAt || nowIso();

  // Normaliza texto
  const text =
    raw?.text?.body ??
    raw?.text ??
    raw?.body ??
    raw?.message ??
    raw?.content ??
    raw?.caption ??
    "";

  // Normaliza "from" + "direction"
  // from: client | agent | bot | system
  // direction: in | out
  let from = raw.from || raw.sender || raw.author || null;
  let direction = raw.direction || null;

  if (from === "user" || from === "contact" || from === "visitor") from = "client";
  if (from === "attendant" || from === "human") from = "agent";

  const isBot = !!(raw.isBot || raw.fromBot || raw.bot === true || from === "bot");

  if (!direction) {
    if (from === "client") direction = "in";
    else direction = "out";
  }

  if (!from) {
    from = direction === "in" ? "client" : "agent";
  }

  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || raw._id || newId("msg"),
    conversationId: String(raw.conversationId || conv?.id || ""),
    // ✅ channel do conv prevalece, mas aceita override
    channel: raw.channel || conv?.channel || conv?.source || "whatsapp",
    type: raw.type || "text",
    from,
    direction,
    isBot,
    text,
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt,
    senderName: raw.senderName || raw.byName || raw.agentName || undefined,
    waMessageId: raw.waMessageId || raw.messageId || undefined
  };
}

function touchConversation(conv, msg) {
  conv.updatedAt = nowIso();
  conv.lastMessageAt = conv.updatedAt;
  const preview = String(msg?.text || "").trim();
  conv.lastMessagePreview = preview ? preview.slice(0, 120) : conv.lastMessagePreview || "";
}

/**
 * ✅ Função ÚNICA para anexar mensagem em qualquer canal (WhatsApp/WebChat/Bot/Humano)
 * MODELO A: não fecha conversa, não “migra” canal.
 */
export function appendMessage(db, conversationId, rawMsg) {
  db = ensureDbShape(db);

  const conv = getConversation(db, conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  const list = ensureConversationMessages(db, conv.id);
  const msg = normalizeMsg(conv, { ...rawMsg, conversationId: String(conv.id) });

  // evita duplicar por id
  if (msg.id && list.some((m) => String(m.id) === String(msg.id))) {
    return { ok: true, msg, duplicated: true };
  }

  list.push(msg);
  touchConversation(conv, msg);

  saveDB(db);
  return { ok: true, msg };
}

/**
 * ✅ UTILIDADE (MODELO A):
 * Cria (ou reabre) conversa SOMENTE do canal informado.
 * Isso impede “matar” webchat quando chega WhatsApp.
 *
 * payload:
 * { source:"whatsapp"|"webchat", peerId:string, title?:string, accountId?:string, channelId?:string, phone?:string, waId?:string, visitorId?:string }
 */
export function getOrCreateChannelConversation(db, payload) {
  db = ensureDbShape(db);

  const source = String(payload?.source || "").toLowerCase();
  if (!source) return { ok: false, error: "source obrigatório" };

  const peerId = String(payload?.peerId || "").trim();
  if (!peerId) return { ok: false, error: "peerId obrigatório" };

  const accountId = payload?.accountId ? String(payload.accountId) : null;

  // acha conversa aberta DO MESMO CANAL
  let conv = db.conversations.find((c) => {
    normalizeConversation(c);
    return (
      c.status === "open" &&
      c.source === source &&
      c.peerId === peerId &&
      (accountId ? c.accountId === accountId : true)
    );
  });

  // se não achar, procura uma fechada do mesmo canal pra reabrir (opcional)
  if (!conv) {
    conv = db.conversations.find((c) => {
      normalizeConversation(c);
      return (
        c.status === "closed" &&
        c.source === source &&
        c.peerId === peerId &&
        (accountId ? c.accountId === accountId : true)
      );
    });

    if (conv) {
      conv.status = "open";
      conv.updatedAt = nowIso();
    }
  }

  if (!conv) {
    const idPrefix = source === "webchat" ? "wc" : source === "whatsapp" ? "wa" : "conv";
    conv = {
      id: newId(idPrefix),
      source,
      channel: source,
      peerId,
      title: payload?.title || "Contato",
      status: "open",
      assignedGroupId: null,
      assignedUserId: null,
      notes: "",
      tags: [],
      accountId: accountId || null,
      channelId: payload?.channelId ? String(payload.channelId) : null,
      phone: payload?.phone || null,
      waId: payload?.waId || null,
      visitorId: payload?.visitorId || null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };

    db.conversations.push(conv);
    ensureConversationMessages(db, conv.id);
    saveDB(db);
  } else {
    saveDB(db);
  }

  return { ok: true, conversation: conv };
}

// ======================================================
// GET /conversations?status=open|closed|all&source=whatsapp|webchat|all
// ======================================================
router.get("/", (req, res) => {
  const db = ensureDbShape(loadDB());
  const status = String(req.query.status || "open");
  const source = String(req.query.source || "all").toLowerCase();

  let items = ensureArray(db.conversations).map(normalizeConversation);

  if (status !== "all") {
    items = items.filter((c) => String(c.status || "open") === status);
  }

  // ✅ filtro por canal (modelo A)
  if (source !== "all") {
    items = items.filter((c) => String(c.source || "") === source);
  }

  items.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return res.json(items);
});

// ======================================================
// GET /conversations/:id/messages
// ======================================================
router.get("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, conv.id);

  list.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });

  return res.json(list);
});

// ======================================================
// POST /conversations/:id/messages  (envio humano/atendente)
// body: { text: string, senderName?: string }
// ======================================================
router.post("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.status) === "closed") {
    return res.status(410).json({ error: "Conversa encerrada" });
  }

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text obrigatório" });

  const result = appendMessage(db, conv.id, {
    from: "agent",
    direction: "out",
    type: "text",
    text,
    senderName: req.body?.senderName || undefined,
    channel: conv.channel || conv.source || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json(result.msg);
});

// ======================================================
// PATCH /conversations/:id/status
// body: { status: "open" | "closed", tags?: string[] }
// ======================================================
router.patch("/:id/status", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const status = String(req.body?.status || "").trim();
  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status inválido (use open|closed)" });
  }

  conv.status = status;
  conv.updatedAt = nowIso();

  if (Array.isArray(req.body?.tags)) conv.tags = req.body.tags;

  // mensagem de sistema (mesma conversa, mesmo canal)
  appendMessage(db, conv.id, {
    type: "system",
    from: "system",
    direction: "out",
    text: status === "closed" ? "Atendimento encerrado." : "Atendimento reaberto.",
    channel: conv.channel || conv.source || "whatsapp"
  });

  saveDB(db);
  return res.json(conv);
});

// ======================================================
// PATCH /conversations/:id/notes
// body: { notes: string }
// ======================================================
router.patch("/:id/notes", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.notes = String(req.body?.notes || "");
  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json(conv);
});

export default router;
