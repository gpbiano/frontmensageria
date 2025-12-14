// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import { loadDB, saveDB } from "../utils/db.js";
import {
  findConversationByVisitor,
  createWebchatConversation,
  addMessage
} from "../services/conversationService.js";

const router = express.Router();

const JWT_SECRET = process.env.WEBCHAT_JWT_SECRET || "webchat_secret_dev";
const TOKEN_TTL_SECONDS = 60 * 60; // 1h

function nowUnix() {
  return Math.floor(Date.now() / 1000);
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

// ----------------------------------------------------
// POST /webchat/session
// Cria ou reaproveita conversa
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = loadDB();

  let conversation = findConversationByVisitor(db, visitorId);
  if (!conversation) {
    conversation = createWebchatConversation(db, { visitorId });
  }

  const token = jwt.sign(
    {
      conversationId: conversation.id,
      visitorId,
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

  // auth (recomendado manter)
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  // garante que token pertence à conversa solicitada
  if (decoded?.conversationId && decoded.conversationId !== id) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const db = loadDB();

  const all = Array.isArray(db.messagesByConversation?.[id])
    ? db.messagesByConversation[id]
    : [];

  let items = all;

  if (after) {
    // aceita cursor por id OU por createdAt ISO
    const idx = all.findIndex((m) => m.id === after);
    if (idx >= 0) {
      items = all.slice(idx + 1);
    } else {
      items = all.filter((m) => String(m.createdAt || "") > after);
    }
  }

  items = items.slice(0, limit);

  const last = items.length ? items[items.length - 1] : null;
  const nextCursor = last ? (last.id || last.createdAt) : (after || null);

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

  const { conversationId } = decoded || {};
  const { text } = req.body || {};

  if (!conversationId) return res.status(400).json({ error: "conversationId ausente no token" });
  if (!text || !String(text).trim()) return res.status(400).json({ error: "Mensagem vazia" });

  const db = loadDB();

  const conv = db.conversations.find((c) => c.id === conversationId);
  if (!conv || conv.status !== "open") {
    return res.status(410).json({ error: "Conversa encerrada" });
  }

  const msg = addMessage(db, conversationId, {
    channel: "webchat",
    from: "visitor",
    text: String(text).trim()
  });

  saveDB(db);

  return res.json({
    ok: true,
    message: msg,
    nextCursor: msg.id
  });
});

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// ----------------------------------------------------
router.post("/conversations/:id/close", (req, res) => {
  const { id } = req.params;

  const db = loadDB();
  const conv = db.conversations.find((c) => c.id === id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.status = "closed";
  conv.updatedAt = new Date().toISOString();

  saveDB(db);
  return res.json({ ok: true });
});

export default router;
