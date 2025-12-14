import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import fs from "fs";
import path from "path";

const router = express.Router();

// ============================
// DB (data.json) helpers
// ============================
const DB_PATH = path.join(process.cwd(), "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_PATH, "utf-8");
    const data = raw ? JSON.parse(raw) : {};
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function ensureArray(x) {
  return Array.isArray(x) ? x : [];
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function ms(iso) {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

// ============================
// CORS DEV (para testar local)
// ============================
router.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowed =
    !origin ||
    origin.includes("http://localhost") ||
    origin.includes("http://127.0.0.1");

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Widget-Key"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).send();
  next();
});

// ============================
// Auth Webchat (JWT curto)
// ============================
function getJwtSecret() {
  return process.env.JWT_SECRET || "dev_secret_change_me";
}

function requireWebchatAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Webchat\s+(.+)$/i);
  if (!m) return res.status(401).json({ error: "Missing Webchat token" });

  try {
    const payload = jwt.verify(m[1], getJwtSecret());
    if (!payload || payload.typ !== "webchat") {
      return res.status(401).json({ error: "Invalid token type" });
    }
    req.webchat = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid/expired token" });
  }
}

// ============================
// MODELO DB (se não existir)
// ============================
function ensureWebchatSchema(db) {
  if (!db.webchat) db.webchat = {};
  if (!db.webchat.conversations) db.webchat.conversations = [];
  return db;
}

function findConversation(db, conversationId) {
  db = ensureWebchatSchema(db);
  return db.webchat.conversations.find((c) => c.id === conversationId);
}

// ============================
// 1) POST /webchat/session
// ============================
router.post("/session", (req, res) => {
  const widgetKey = req.headers["x-widget-key"];
  if (!widgetKey) return res.status(400).json({ error: "Missing X-Widget-Key" });

  const { visitorId, pageUrl, referrer, utm } = req.body || {};

  const db = ensureWebchatSchema(loadDB());

  const convId = newId("conv_web");
  const sessionId = newId("wsess");

  const createdAt = nowIso();

  const conversation = {
    id: convId,
    channel: "web",
    widgetKey,
    visitorId: visitorId || null,
    pageUrl: pageUrl || null,
    referrer: referrer || null,
    utm: utm || null,
    status: "open",
    createdAt,
    updatedAt: createdAt,
    closedAt: null,
    closedBy: null,
    closedReason: null,
    messages: [
      {
        id: newId("msg"),
        from: "bot",
        type: "text",
        text: "Olá! Como posso ajudar?",
        createdAt
      }
    ]
  };

  db.webchat.conversations.unshift(conversation);
  saveDB(db);

  const expiresInSeconds = 60 * 30; // 30 min

  const webchatToken = jwt.sign(
    { typ: "webchat", widgetKey, conversationId: convId, sessionId },
    getJwtSecret(),
    { expiresIn: expiresInSeconds }
  );

  const lastCursor = conversation.messages.at(-1)?.createdAt || null;

  res.json({
    sessionId,
    conversationId: convId,
    status: "open",
    expiresInSeconds,
    webchatToken,
    lastCursor
  });
});

// ============================
// 2) POST /webchat/messages
// ============================
router.post("/messages", requireWebchatAuth, (req, res) => {
  const { conversationId, text } = req.body || {};
  if (!conversationId) return res.status(400).json({ error: "Missing conversationId" });

  const msgText = String(text || "").trim();
  if (!msgText) return res.status(400).json({ error: "Empty message" });
  if (msgText.length > 2000) return res.status(400).json({ error: "Message too long" });

  // Token só pode mexer na própria conversa
  if (req.webchat.conversationId !== conversationId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const db = ensureWebchatSchema(loadDB());
  const conv = findConversation(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  if (conv.status !== "open") {
    return res.status(409).json({ error: "Conversation is closed" });
  }

  const createdAt = nowIso();

  const message = {
    id: newId("msg"),
    from: "visitor",
    type: "text",
    text: msgText,
    createdAt
  };

  conv.messages = ensureArray(conv.messages);
  conv.messages.push(message);
  conv.updatedAt = createdAt;

  saveDB(db);

  // cursor: último createdAt
  res.json({
    ok: true,
    messageId: message.id,
    nextCursor: createdAt
  });
});

// ============================
// 3) GET /webchat/conversations/:id/messages?after=<ISO>&limit=50
// ============================
router.get("/conversations/:id/messages", requireWebchatAuth, (req, res) => {
  const conversationId = req.params.id;

  if (req.webchat.conversationId !== conversationId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const db = ensureWebchatSchema(loadDB());
  const conv = findConversation(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  const after = req.query.after ? String(req.query.after) : null;
  const limitRaw = req.query.limit ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50;

  const items = ensureArray(conv.messages)
    .filter((m) => !after || ms(m.createdAt) > ms(after))
    .slice(0, limit);

  const nextCursor = items.length ? items[items.length - 1].createdAt : after;

  res.json({ items, nextCursor });
});

// ============================
// 4) POST /webchat/conversations/:id/close
// ============================
router.post("/conversations/:id/close", requireWebchatAuth, (req, res) => {
  const conversationId = req.params.id;

  if (req.webchat.conversationId !== conversationId) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const db = ensureWebchatSchema(loadDB());
  const conv = findConversation(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });

  if (conv.status === "closed") {
    return res.json({ ok: true, status: "closed" });
  }

  const createdAt = nowIso();
  const reason = (req.body && req.body.reason) ? String(req.body.reason) : "user_closed";

  conv.status = "closed";
  conv.closedAt = createdAt;
  conv.closedBy = "user";
  conv.closedReason = reason;
  conv.updatedAt = createdAt;

  saveDB(db);

  res.json({ ok: true, status: "closed" });
});

export default router;
