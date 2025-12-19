// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import { loadDB, saveDB } from "../utils/db.js";

// CORE OFICIAL
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

/**
 * =========================
 * DB SHAPE (ALINHADO COM channelsStorage)
 * =========================
 */
function ensureDbShape(db) {
  if (!db.conversations) db.conversations = [];
  if (!db.messagesByConversation) db.messagesByConversation = {};
  if (!db.settings) db.settings = {};
  if (!db.settings.channels) db.settings.channels = {};
  if (!db.settings.channels.webchat) {
    db.settings.channels.webchat = {
      enabled: false,
      widgetKey: "",
      allowedOrigins: [],
      config: {}
    };
  }
  if (!db.chatbot) db.chatbot = {};
  return db;
}

function getConversationOr404(db, id) {
  return db.conversations.find((c) => String(c.id) === String(id)) || null;
}

/**
 * =========================
 * AUTH HELPERS
 * =========================
 */
function readAuthToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Webchat ")) return auth.slice("Webchat ".length).trim();

  const xToken = String(req.headers["x-webchat-token"] || "").trim();
  if (xToken) return xToken;

  const qToken = String(req.query.token || "").trim();
  if (qToken) return qToken;

  return "";
}

function verifyWebchatToken(req) {
  const token = readAuthToken(req);
  if (!token) throw new Error("Token ausente");
  return jwt.verify(token, JWT_SECRET);
}

/**
 * =========================
 * CHANNEL RULES (WEBCHAT)
 * =========================
 */
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function getRequestOrigin(req) {
  const origin = normalizeOrigin(req.headers.origin);
  if (origin) return origin;

  const ref = String(req.headers.referer || "").trim();
  try {
    if (ref) return normalizeOrigin(new URL(ref).origin);
  } catch {}
  return "";
}

function readWidgetKey(req) {
  const h = String(req.headers["x-widget-key"] || "").trim();
  if (h) return h;
  return String(req.query.widgetKey || req.query.widget_key || "").trim();
}

function isOriginAllowed(origin, allowedOrigins) {
  // server-to-server
  if (!origin) return true;

  const allowed = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(normalizeOrigin)
    : [];

  if (!allowed.length) return false;
  return allowed.includes(normalizeOrigin(origin));
}

function assertWebchatAllowed(db, req) {
  const webchat = db.settings.channels.webchat;

  if (webchat.enabled === false) {
    return { ok: false, status: 403, error: "WebChat desativado" };
  }

  const origin = getRequestOrigin(req);
  if (!isOriginAllowed(origin, webchat.allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: "Origin não permitido",
      details: { origin, allowedOrigins: webchat.allowedOrigins }
    };
  }

  const configuredKey = String(webchat.widgetKey || "").trim();
  if (configuredKey) {
    const key = readWidgetKey(req);
    if (!key || key !== configuredKey) {
      return { ok: false, status: 403, error: "widgetKey inválida ou ausente" };
    }
  }

  return { ok: true };
}

/**
 * =========================
 * CORS (WEBCHAT) - IMPORTANTE
 * =========================
 * - Responde Access-Control-Allow-Origin SOMENTE se origin estiver permitido
 * - Libera header X-Widget-Key (que estava bloqueando a sessão)
 */
function setCorsHeaders(req, res, db) {
  const origin = normalizeOrigin(req.headers.origin || "");
  const allowedOrigins = db?.settings?.channels?.webchat?.allowedOrigins || [];

  if (origin && isOriginAllowed(origin, allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Widget-Key, X-Webchat-Token"
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * =========================
 * CHATBOT (WEBCHAT)
 * =========================
 */
function isWebchatBotEnabled(db) {
  return db.chatbot?.webchatEnabled === true;
}

async function maybeReplyWithBot(db, conv, cleanText) {
  if (!isWebchatBotEnabled(db)) return { ok: true, didBot: false };
  if (String(conv.currentMode || "") === "human") return { ok: true, didBot: false };
  if (String(conv.status || "") !== "open") return { ok: true, didBot: false };

  let botEngine;
  try {
    const mod = await import("../chatbot/botEngine.js");
    botEngine = mod?.default || mod?.botEngine || mod;
  } catch {
    return { ok: true, didBot: false };
  }

  if (typeof botEngine !== "function" && typeof botEngine?.run !== "function") {
    return { ok: true, didBot: false };
  }

  const history =
    (db.messagesByConversation?.[String(conv.id)] || []).slice(-10);

  let botText = "";
  try {
    if (typeof botEngine === "function") {
      botText = await botEngine({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: history
      });
    } else {
      botText = await botEngine.run({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: history
      });
    }
  } catch {
    return { ok: true, didBot: false };
  }

  botText = String(botText || "").trim();
  if (!botText) return { ok: true, didBot: false };

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    direction: "out",
    text: botText,
    createdAt: nowIso()
  });

  return r?.ok ? { ok: true, didBot: true, botMessage: r.msg } : { ok: false };
}

/**
 * =========================
 * ROUTES
 * =========================
 */

// ✅ Preflight completo (corrige o erro do X-Widget-Key)
router.options("*", (req, res) => {
  const db = ensureDbShape(loadDB());
  setCorsHeaders(req, res, db);
  return res.status(204).end();
});

// ----------------------------------------------------
// POST /webchat/session
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = ensureDbShape(loadDB());
  setCorsHeaders(req, res, db);

  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  const initialMode = isWebchatBotEnabled(db) ? "bot" : "human";

  const r = getOrCreateChannelConversation(db, {
    source: "webchat",
    peerId: `wc:${visitorId}`,
    visitorId,
    title: `WebChat ${String(visitorId).slice(0, 6)}`,
    currentMode: initialMode
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao criar sessão" });

  const token = jwt.sign(
    {
      conversationId: r.conversation.id,
      visitorId,
      source: "webchat",
      iat: nowUnix(),
      exp: nowUnix() + TOKEN_TTL_SECONDS
    },
    JWT_SECRET
  );

  saveDB(db);

  return res.json({
    conversationId: r.conversation.id,
    webchatToken: token,
    status: r.conversation.status,
    currentMode: r.conversation.currentMode,
    expiresInSeconds: TOKEN_TTL_SECONDS
  });
});

// ----------------------------------------------------
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
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
  setCorsHeaders(req, res, db);

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
// ----------------------------------------------------
router.post("/messages", async (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const cleanText = String(req.body?.text || "").trim();
  if (!cleanText) return res.status(400).json({ error: "Mensagem vazia" });

  const db = ensureDbShape(loadDB());
  setCorsHeaders(req, res, db);

  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  const conv = getConversationOr404(db, decoded.conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }
  if (String(conv.status) !== "open") return res.status(410).json({ error: "Conversa encerrada" });

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso()
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao salvar mensagem" });

  const bot = await maybeReplyWithBot(db, conv, cleanText);

  saveDB(db);

  return res.json({
    ok: true,
    message: r.msg,
    nextCursor: r.msg?.id,
    bot: bot?.didBot ? { message: bot.botMessage } : null
  });
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
  setCorsHeaders(req, res, db);

  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  if (String(conv.status) === "closed") {
    saveDB(db);
    return res.json({ ok: true, status: "closed" });
  }

  conv.status = "closed";
  conv.updatedAt = nowIso();
  conv.closedAt = nowIso();
  conv.closedReason = "webchat_widget_close";

  // (Opcional) registrar mensagem de system
  appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "system",
    from: "system",
    direction: "out",
    text: "Conversa encerrada.",
    createdAt: nowIso()
  });

  saveDB(db);
  return res.json({ ok: true, status: "closed" });
});

export default router;
