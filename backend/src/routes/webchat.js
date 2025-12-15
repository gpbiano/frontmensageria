// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import { loadDB, saveDB } from "../utils/db.js";

// ✅ CORE OFICIAL
import { getOrCreateChannelConversation, appendMessage } from "./conversations.js";

const router = express.Router();

const JWT_SECRET = process.env.WEBCHAT_JWT_SECRET || "webchat_secret_dev";
const TOKEN_TTL_SECONDS = 60 * 60; // 1h

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function readAuthToken(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Webchat ")) return "";
  return auth.slice("Webchat ".length).trim();
}

function verifyWebchatToken(req) {
  const token = readAuthToken(req);
  if (!token) throw new Error("Token ausente");
  return jwt.verify(token, JWT_SECRET);
}

function ensureDbShape(db) {
  if (!db.conversations) db.conversations = [];
  if (!db.messagesByConversation) db.messagesByConversation = {};
  return db;
}

function getConversationOr404(db, id) {
  return db.conversations.find((c) => String(c.id) === String(id)) || null;
}

// ----------------------------------------------------
// POST /webchat/session
// Cria ou reaproveita conversa (somente WEBCHAT)
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = ensureDbShape(loadDB());

  // ✅ cria/reutiliza via CORE (Modelo A)
  const r = getOrCreateChannelConversation(db, {
    source: "webchat",
    peerId: `wc:${visitorId}`,
    visitorId,
    title: `WebChat ${String(visitorId).slice(0, 6)}`,
    currentMode: "human"
  });

  if (!r?.ok) return res.status(400).json({ error: r?.error || "Falha ao criar sessão" });

  const conversation = r.conversation;

  const token = jwt.sign(
    {
      conversationId: conversation.id,
      visitorId,
      source: "webchat",
      iat: nowUnix(),
      exp: nowUnix() + TOKEN_TTL_SECONDS
    },
    JWT_SECRET
  );

  saveDB(db);

  return res.json({
    conversationId: conversation.id,
    webchatToken: token,
    status: conversation.status,
    expiresInSeconds: TOKEN_TTL_SECONDS
  });
});

// ----------------------------------------------------
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
// Retorna novas mensagens (polling do widget)
// ----------------------------------------------------
router.get("/conversations/:id/messages", (req, res) => {
  const { id } = req.params;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const db = ensureDbShape(loadDB());

  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  const all = Array.isArray(db.messagesByConversation?.[String(id)])
    ? db.messagesByConversation[String(id)]
    : [];

  let items = all;

  if (after) {
    const idx = all.findIndex((m) => String(m.id) === String(after));
    if (idx >= 0) items = all.slice(idx + 1);
    else items = all.filter((m) => String(m.createdAt || "") > after);
  }

  items = items.slice(0, limit);

  const last = items.length ? items[items.length - 1] : null;
  const nextCursor = last ? (last.id || last.createdAt) : after || null;

  return res.json({ items, nextCursor });
});

// ----------------------------------------------------
// POST /webchat/messages
// Visitor envia mensagem
// ----------------------------------------------------
router.post("/messages", (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const { conversationId, source } = decoded || {};
  const { text } = req.body || {};

  if (!conversationId) return res.status(400).json({ error: "conversationId ausente no token" });
  if (source && source !== "webchat") return res.status(403).json({ error: "Token não é de Webchat" });

  const cleanText = String(text || "").trim();
  if (!cleanText) return res.status(400).json({ error: "Mensagem vazia" });

  const db = ensureDbShape(loadDB());

  const conv = getConversationOr404(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }
  if (String(conv.status) !== "open") return res.status(410).json({ error: "Conversa encerrada" });

  // ✅ persiste via CORE oficial
  const result = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso()
  });

  if (!result?.ok) return res.status(400).json({ error: result?.error || "Falha ao salvar mensagem" });

  saveDB(db);

  return res.json({ ok: true, message: result.msg, nextCursor: result.msg.id });
});

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// ----------------------------------------------------
router.post("/conversations/:id/close", (req, res) => {
  const { id } = req.params;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const db = ensureDbShape(loadDB());
  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  conv.status = "closed";
  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json({ ok: true });
});

export default router;
