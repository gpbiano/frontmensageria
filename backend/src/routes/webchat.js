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

/**
 * ⚠️ Anti-conflito WhatsApp x Webchat
 * - garante prefixo wc_ para conversas criadas pelo widget
 * - garante que endpoints webchat só operam em conversas source=webchat
 */
function ensureWebchatConversationIdentity(db, conv) {
  if (!conv) return conv;

  // marca explicitamente a origem
  if (!conv.source) conv.source = "webchat";
  if (!conv.channel) conv.channel = "webchat";

  // se por algum motivo veio uma conversa de outra origem, bloqueia
  if (conv.source !== "webchat") return null;

  // garante prefixo wc_ no id (evita colisão com conversas do WhatsApp)
  if (conv.id && !String(conv.id).startsWith("wc_")) {
    // só renomeia com segurança se não houver mensagens vinculadas ainda
    const hasMsgs =
      Array.isArray(db.messagesByConversation?.[conv.id]) &&
      db.messagesByConversation[conv.id].length > 0;

    if (!hasMsgs) {
      const oldId = conv.id;
      conv.id = `wc_${oldId}`;

      // move bucket se existir vazio/placeholder
      if (db.messagesByConversation?.[oldId] && !db.messagesByConversation[conv.id]) {
        db.messagesByConversation[conv.id] = db.messagesByConversation[oldId];
        delete db.messagesByConversation[oldId];
      }
    }
  }

  return conv;
}

function getConversationOr404(db, id) {
  const conv = db.conversations.find((c) => String(c.id) === String(id));
  if (!conv) return null;
  return conv;
}

// ----------------------------------------------------
// POST /webchat/session
// Cria ou reaproveita conversa (somente WEBCHAT)
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = ensureDbShape(loadDB());

  // procura conversa por visitorId, mas só aceita se for de origem webchat
  let conversation = findConversationByVisitor(db, visitorId);
  conversation = ensureWebchatConversationIdentity(db, conversation);

  // se não existe (ou não é webchat), cria uma nova
  if (!conversation) {
    conversation = createWebchatConversation(db, { visitorId });

    // reforça identidade/prefixo/markers (anti conflito)
    conversation = ensureWebchatConversationIdentity(db, conversation);

    // fallback: se o service não marcou, garantimos aqui
    conversation.source = "webchat";
    conversation.channel = "webchat";
    conversation.status = conversation.status || "open";
    conversation.createdAt = conversation.createdAt || nowIso();
    conversation.updatedAt = nowIso();
  } else {
    conversation.updatedAt = nowIso();
  }

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

  // auth
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  // token deve pertencer à conversa solicitada
  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const db = ensureDbShape(loadDB());

  // garante que é conversa do webchat (anti conflito)
  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  const all = Array.isArray(db.messagesByConversation?.[id])
    ? db.messagesByConversation[id]
    : [];

  let items = all;

  if (after) {
    // aceita cursor por id OU por createdAt ISO
    const idx = all.findIndex((m) => String(m.id) === String(after));
    if (idx >= 0) {
      items = all.slice(idx + 1);
    } else {
      items = all.filter((m) => String(m.createdAt || "") > after);
    }
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

  if (!conversationId)
    return res.status(400).json({ error: "conversationId ausente no token" });
  if (source && source !== "webchat")
    return res.status(403).json({ error: "Token não é de Webchat" });

  if (!text || !String(text).trim())
    return res.status(400).json({ error: "Mensagem vazia" });

  const db = ensureDbShape(loadDB());

  // garante que é conversa do webchat (anti conflito)
  const conv = getConversationOr404(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  if (conv.status !== "open") {
    return res.status(410).json({ error: "Conversa encerrada" });
  }

  const msg = addMessage(db, conversationId, {
    channel: "webchat",
    from: "visitor",
    text: String(text).trim()
  });

  // atualiza timestamp da conversa
  conv.updatedAt = nowIso();

  saveDB(db);

  return res.json({
    ok: true,
    message: msg,
    nextCursor: msg.id
  });
});

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// (mantém o auth, e só fecha conversa do webchat)
// ----------------------------------------------------
router.post("/conversations/:id/close", (req, res) => {
  const { id } = req.params;

  // auth (evita alguém fechar conversa alheia)
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
