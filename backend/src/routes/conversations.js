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

function ensureMessagesByConversation(db) {
  if (!db.messagesByConversation || typeof db.messagesByConversation !== "object") {
    db.messagesByConversation = {};
  }
  return db.messagesByConversation;
}

function ensureConversationMessages(db, conversationId) {
  const map = ensureMessagesByConversation(db);
  const key = String(conversationId);
  if (!Array.isArray(map[key])) map[key] = [];
  return map[key];
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

  // Alguns provedores usam "user"/"contact" etc.
  if (from === "user" || from === "contact" || from === "visitor") from = "client";
  if (from === "attendant" || from === "human") from = "agent";

  const isBot = !!(raw.isBot || raw.fromBot || raw.bot === true || from === "bot");

  // Se vier direction ausente, inferimos:
  if (!direction) {
    if (from === "client") direction = "in";
    else direction = "out";
  }

  // Se vier from ausente, inferimos pelo direction:
  if (!from) {
    from = direction === "in" ? "client" : "agent";
  }

  // Se marcou bot, forçamos
  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || raw._id || newId("msg"),
    conversationId: String(raw.conversationId || conv?.id || ""),
    channel: raw.channel || conv?.channel || "whatsapp",
    type: raw.type || "text",
    from,          // client | agent | bot | system
    direction,     // in | out
    isBot,
    text,
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt,
    // extras opcionais
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

function getConversation(db, id) {
  const convs = ensureArray(db.conversations);
  return convs.find((c) => String(c.id) === String(id));
}

/**
 * ✅ Função ÚNICA para anexar mensagem em qualquer canal (WhatsApp/WebChat/Bot/Humano)
 * Use essa mesma lógica também no webhook do WhatsApp.
 */
export function appendMessage(db, conversationId, rawMsg) {
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

// ======================================================
// GET /conversations?status=open|closed|all
// ======================================================
router.get("/", (req, res) => {
  const db = loadDB();
  const status = String(req.query.status || "open");

  let items = ensureArray(db.conversations);

  if (status !== "all") {
    items = items.filter((c) => String(c.status || "open") === status);
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
  const db = loadDB();
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, conv.id);

  // ordena por createdAt asc (cronológica)
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
  const db = loadDB();
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
    channel: conv.channel || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json(result.msg);
});

// ======================================================
// PATCH /conversations/:id/status
// body: { status: "open" | "closed", tags?: string[] }
// ======================================================
router.patch("/:id/status", (req, res) => {
  const db = loadDB();
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const status = String(req.body?.status || "").trim();
  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status inválido (use open|closed)" });
  }

  conv.status = status;
  conv.updatedAt = nowIso();

  // opcional
  if (Array.isArray(req.body?.tags)) conv.tags = req.body.tags;

  // mensagem de sistema
  appendMessage(db, conv.id, {
    type: "system",
    from: "system",
    direction: "out",
    text: status === "closed" ? "Atendimento encerrado." : "Atendimento reaberto."
  });

  // appendMessage já salvou, mas aqui garantimos caso falhe acima
  saveDB(db);

  return res.json(conv);
});

// ======================================================
// PATCH /conversations/:id/notes
// body: { notes: string }
// ======================================================
router.patch("/:id/notes", (req, res) => {
  const db = loadDB();
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.notes = String(req.body?.notes || "");
  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json(conv);
});

export default router;
