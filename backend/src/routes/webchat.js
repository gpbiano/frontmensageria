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

function now() {
  return Math.floor(Date.now() / 1000);
}

// ----------------------------------------------------
// POST /webchat/session
// Cria ou reaproveita conversa
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId, pageUrl, referrer } = req.body || {};
  if (!visitorId) {
    return res.status(400).json({ error: "visitorId obrigatório" });
  }

  const db = loadDB();

  let conversation = findConversationByVisitor(db, visitorId);
  if (!conversation) {
    conversation = createWebchatConversation(db, { visitorId });
  }

  const token = jwt.sign(
    {
      conversationId: conversation.id,
      visitorId,
      iat: now(),
      exp: now() + TOKEN_TTL_SECONDS
    },
    JWT_SECRET
  );

  saveDB(db);

  return res.json({
    conversationId: conversation.id,
    webchatToken: token,
    status: conversation.status
  });
});

// ----------------------------------------------------
// POST /webchat/messages
// Visitor envia mensagem
// ----------------------------------------------------
router.post("/messages", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.replace("Webchat ", "");

  if (!token) {
    return res.status(401).json({ error: "Token ausente" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token inválido" });
  }

  const { conversationId, visitorId } = decoded;
  const { text } = req.body || {};

  if (!text || !String(text).trim()) {
    return res.status(400).json({ error: "Mensagem vazia" });
  }

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
    message: msg
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
