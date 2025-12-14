// backend/src/routes/webchat.js
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";

import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import logger from "../logger.js";

const router = express.Router();

// ===============================
// ENV
// ===============================
const WEBCHAT_JWT_SECRET =
  process.env.WEBCHAT_JWT_SECRET || process.env.JWT_SECRET || "dev_webchat_secret";

const WEBCHAT_TOKEN_TTL_SEC = Number(process.env.WEBCHAT_TOKEN_TTL_SEC || 1800); // 30min
const WEBCHAT_SESSION_MAX_AGE_HOURS = Number(process.env.WEBCHAT_SESSION_MAX_AGE_HOURS || 24); // janela web
const DEV_ALLOW_LOCALHOST = (process.env.WEBCHAT_DEV_ALLOW_LOCALHOST || "true") === "true";

// ===============================
// Helpers
// ===============================
function nowIso() {
  return new Date().toISOString();
}
function msHours(h) {
  return h * 60 * 60 * 1000;
}
function newId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}
function normalizeOrigin(o) {
  if (!o) return "";
  try {
    const u = new URL(o);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(o).trim();
  }
}
function isOriginAllowed(origin, allowedOrigins = []) {
  const o = normalizeOrigin(origin);

  // DEV
  if (DEV_ALLOW_LOCALHOST) {
    if (
      o.startsWith("http://localhost") ||
      o.startsWith("http://127.0.0.1") ||
      o.startsWith("http://0.0.0.0")
    ) return true;
  }

  const list = (allowedOrigins || []).map(normalizeOrigin).filter(Boolean);
  return !!o && list.includes(o);
}
function getAuthToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Webchat\s+(.+)$/i);
  return m ? m[1] : null;
}
function signWebchatToken(payload, ttlSec = WEBCHAT_TOKEN_TTL_SEC) {
  return jwt.sign(payload, WEBCHAT_JWT_SECRET, { expiresIn: ttlSec });
}
function verifyWebchatToken(token) {
  return jwt.verify(token, WEBCHAT_JWT_SECRET);
}
function ensureWebchatChannel(db, widgetKey) {
  db.channels = ensureArray(db.channels);

  // Canal webchat é armazenado em channels[] com type="webchat"
  const ch = db.channels.find(
    (c) => c?.type === "webchat" && c?.security?.widgetKey === widgetKey
  );
  return ch || null;
}
function ensureConversationStructures(db) {
  db.conversations = ensureArray(db.conversations);
  db.webchatMessages = ensureArray(db.webchatMessages); // mensagens do webchat
}

// ===============================
// Middleware: valida widgetKey + Origin allowlist + canal ativo
// ===============================
async function validateWidget(req, res, next) {
  try {
    const widgetKey = req.header("X-Widget-Key") || "";
    if (!widgetKey) {
      return res.status(401).json({ error: "missing_widget_key" });
    }

    const db = await loadDB();
    const ch = ensureWebchatChannel(db, widgetKey);

    if (!ch || !ch.active) {
      return res.status(403).json({ error: "webchat_channel_inactive" });
    }

    const origin = req.headers.origin || "";
    const allowed = ch.security?.allowedOrigins || [];
    if (!isOriginAllowed(origin, allowed)) {
      return res.status(403).json({ error: "origin_not_allowed" });
    }

    // CORS curto para widget
    res.setHeader("Access-Control-Allow-Origin", normalizeOrigin(origin));
    res.setHeader("Vary", "Origin");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Widget-Key"
    );
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

    req.webchatChannel = ch;
    req.webchatWidgetKey = widgetKey;
    next();
  } catch (e) {
    logger.error({ err: e }, "validateWidget failed");
    res.status(500).json({ error: "internal_error" });
  }
}

// Preflight
router.options("/*", validateWidget, (req, res) => res.sendStatus(204));

// ===============================
// POST /webchat/session
// Cria (ou reaproveita) sessão/conversa para visitorId
// ===============================
router.post("/session", validateWidget, async (req, res) => {
  try {
    const ch = req.webchatChannel;
    const { visitorId, pageUrl, referrer, utm } = req.body || {};
    if (!visitorId) return res.status(400).json({ error: "missing_visitorId" });

    const db = await loadDB();
    ensureConversationStructures(db);

    // Reutiliza conversa OPEN recente desse visitor + canal
    const cutoff = Date.now() - msHours(WEBCHAT_SESSION_MAX_AGE_HOURS);
    const existing = db.conversations
      .filter((c) => c?.channel === "webchat")
      .filter((c) => c?.channelId === ch.id)
      .filter((c) => c?.visitorId === visitorId)
      .filter((c) => c?.status === "open")
      .find((c) => new Date(c.createdAt).getTime() >= cutoff);

    let conv = existing;
    if (!conv) {
      conv = {
        id: newId("conv"),
        channel: "webchat",
        channelId: ch.id,
        widgetKey: ch.security?.widgetKey,
        visitorId,
        status: "open",
        createdAt: nowIso(),
        updatedAt: nowIso(),
        meta: {
          pageUrl: pageUrl || "",
          referrer: referrer || "",
          utm: utm || null,
          origin: normalizeOrigin(req.headers.origin || "")
        }
      };
      db.conversations.unshift(conv);
      await saveDB(db);
    }

    const tokenPayload = {
      typ: "webchat",
      channelId: ch.id,
      conversationId: conv.id,
      visitorId
    };

    const webchatToken = signWebchatToken(tokenPayload, WEBCHAT_TOKEN_TTL_SEC);

    // Cursor inicial: último id de msg (se existir)
    const lastMsg = db.webchatMessages
      .filter((m) => m?.conversationId === conv.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .slice(-1)[0];

    return res.json({
      conversationId: conv.id,
      sessionId: null,
      status: conv.status,
      webchatToken,
      expiresInSeconds: WEBCHAT_TOKEN_TTL_SEC,
      lastCursor: lastMsg ? lastMsg.id : null
    });
  } catch (e) {
    logger.error({ err: e }, "POST /webchat/session failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// ===============================
// Auth middleware por token
// ===============================
function requireWebchatToken(req, res, next) {
  try {
    const token = getAuthToken(req);
    if (!token) return res.status(401).json({ error: "missing_webchat_token" });

    const payload = verifyWebchatToken(token);
    req.webchatAuth = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: "invalid_webchat_token" });
  }
}

// ===============================
// POST /webchat/messages
// Envia msg do visitor
// ===============================
router.post("/messages", validateWidget, requireWebchatToken, async (req, res) => {
  try {
    const { conversationId, text } = req.body || {};
    const auth = req.webchatAuth;

    if (!conversationId) return res.status(400).json({ error: "missing_conversationId" });
    if (!text) return res.status(400).json({ error: "missing_text" });

    // Segurança: token deve bater com a conversa
    if (auth.conversationId !== conversationId) {
      return res.status(403).json({ error: "token_conversation_mismatch" });
    }

    const db = await loadDB();
    ensureConversationStructures(db);

    const conv = db.conversations.find((c) => c?.id === conversationId);
    if (!conv) return res.status(404).json({ error: "conversation_not_found" });
    if (conv.status !== "open") return res.status(409).json({ error: "conversation_closed" });

    const msg = {
      id: newId("msg"),
      conversationId,
      from: "visitor",
      type: "text",
      text: String(text),
      createdAt: nowIso()
    };

    db.webchatMessages.push(msg);

    // Atualiza updatedAt
    conv.updatedAt = nowIso();

    await saveDB(db);

    return res.json({
      ok: true,
      messageId: msg.id,
      nextCursor: msg.id
    });
  } catch (e) {
    logger.error({ err: e }, "POST /webchat/messages failed");
    res.status(500).json({ error: "internal_error" });
  }
});

// ===============================
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
// ===============================
router.get(
  "/conversations/:id/messages",
  validateWidget,
  requireWebchatToken,
  async (req, res) => {
    try {
      const conversationId = req.params.id;
      const auth = req.webchatAuth;

      if (auth.conversationId !== conversationId) {
        return res.status(403).json({ error: "token_conversation_mismatch" });
      }

      const after = req.query.after ? String(req.query.after) : null;
      const limit = Math.min(Number(req.query.limit || 50), 200);

      const db = await loadDB();
      ensureConversationStructures(db);

      const all = db.webchatMessages
        .filter((m) => m?.conversationId === conversationId)
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      let startIdx = 0;
      if (after) {
        const idx = all.findIndex((m) => m.id === after);
        startIdx = idx >= 0 ? idx + 1 : 0;
      }

      const items = all.slice(startIdx, startIdx + limit);
      const last = items.length ? items[items.length - 1] : null;

      return res.json({
        items,
        nextCursor: last ? last.id : after
      });
    } catch (e) {
      logger.error({ err: e }, "GET /webchat/conversations/:id/messages failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ===============================
// POST /webchat/conversations/:id/close
// ===============================
router.post(
  "/conversations/:id/close",
  validateWidget,
  requireWebchatToken,
  async (req, res) => {
    try {
      const conversationId = req.params.id;
      const auth = req.webchatAuth;

      if (auth.conversationId !== conversationId) {
        return res.status(403).json({ error: "token_conversation_mismatch" });
      }

      const reason = req.body?.reason || "user_closed";

      const db = await loadDB();
      ensureConversationStructures(db);

      const conv = db.conversations.find((c) => c?.id === conversationId);
      if (!conv) return res.status(404).json({ error: "conversation_not_found" });

      conv.status = "closed";
      conv.closedAt = nowIso();
      conv.closeReason = reason;
      conv.updatedAt = nowIso();

      await saveDB(db);

      return res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "POST /webchat/conversations/:id/close failed");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
