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
  return String(req.query.widgetKey || "").trim();
}

function isOriginAllowed(origin, allowedOrigins) {
  if (!origin) return true; // server-to-server
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
 * CHATBOT (WEBCHAT)
 * =========================
 */
function isWebchatBotEnabled(db) {
  return db.chatbot?.webchatEnabled === true;
}

async function maybeReplyWithBot(db, conv, cleanText) {
  if (!isWebchatBotEnabled(db)) return { ok: true, didBot: false };
  if (conv.currentMode === "human") return { ok: true, didBot: false };
  if (conv.status !== "open") return { ok: true, didBot: false };

  let botEngine;
  try {
    const mod = await import("../chatbot/botEngine.js");
    botEngine = mod?.default || mod;
  } catch {
    return { ok: true, didBot: false };
  }

  const history =
    db.messagesByConversation?.[String(conv.id)]?.slice(-10) || [];

  let botText = "";
  try {
    botText = await botEngine({
      channel: "webchat",
      conversation: conv,
      userText: cleanText,
      messages: history
    });
  } catch {
    return { ok: true, didBot: false };
  }

  if (!botText) return { ok: true, didBot: false };

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    direction: "out",
    text: String(botText),
    createdAt: nowIso()
  });

  return r?.ok ? { ok: true, didBot: true } : { ok: false };
}

/**
 * =========================
 * ROUTES
 * =========================
 */
router.options("*", (_, res) => res.status(204).end());

router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = ensureDbShape(loadDB());

  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json(allow);

  const initialMode = isWebchatBotEnabled(db) ? "bot" : "human";

  const r = getOrCreateChannelConversation(db, {
    source: "webchat",
    peerId: `wc:${visitorId}`,
    visitorId,
    title: `WebChat ${visitorId.slice(0, 6)}`,
    currentMode: initialMode
  });

  if (!r?.ok) return res.status(400).json({ error: r.error });

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

  res.json({
    conversationId: r.conversation.id,
    webchatToken: token,
    currentMode: initialMode,
    expiresInSeconds: TOKEN_TTL_SECONDS
  });
});

router.get("/conversations/:id/messages", (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }

  const db = ensureDbShape(loadDB());
  const conv = getConversationOr404(db, decoded.conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const all = db.messagesByConversation[String(conv.id)] || [];
  res.json({ items: all.slice(-50) });
});

router.post("/messages", async (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }

  const cleanText = String(req.body?.text || "").trim();
  if (!cleanText) return res.status(400).json({ error: "Mensagem vazia" });

  const db = ensureDbShape(loadDB());

  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json(allow);

  const conv = getConversationOr404(db, decoded.conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso()
  });

  if (!r?.ok) return res.status(400).json({ error: r.error });

  await maybeReplyWithBot(db, conv, cleanText);
  saveDB(db);

  res.json({ ok: true });
});

router.post("/conversations/:id/close", (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }

  const db = ensureDbShape(loadDB());
  const conv = getConversationOr404(db, decoded.conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.status = "closed";
  conv.updatedAt = nowIso();

  saveDB(db);
  res.json({ ok: true });
});

export default router;
