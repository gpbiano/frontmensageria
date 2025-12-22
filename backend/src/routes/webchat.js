// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import logger from "../logger.js";
import { loadDB, saveDB } from "../utils/db.js";

// ✅ Prisma (multi-tenant config)
// (seu projeto usa export default no ../lib/prisma.js)
import prisma from "../lib/prisma.js";

const router = express.Router();

const TOKEN_TTL_SECONDS = 60 * 60; // 1h

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}
function nowIso() {
  return new Date().toISOString();
}

/**
 * =========================
 * JWT SECRET (SEM fallback inseguro em produção)
 * =========================
 */
function getWebchatJwtSecret() {
  const secret = process.env.WEBCHAT_JWT_SECRET || process.env.JWT_SECRET;

  if (!secret || !String(secret).trim()) {
    // Dev fallback (somente fora de produção)
    if ((process.env.NODE_ENV || "development") !== "production") {
      logger.warn(
        "⚠️ WEBCHAT_JWT_SECRET/JWT_SECRET ausente. Usando secret dev APENAS em development."
      );
      return "webchat_secret_dev_only";
    }
    throw new Error("WEBCHAT_JWT_SECRET/JWT_SECRET não definido.");
  }
  return String(secret).trim();
}

/**
 * =========================
 * ✅ Conversations CORE loader (compat)
 * - Resolve o erro: "does not provide an export named 'appendMessage'"
 * - Tenta achar appendMessage/getOrCreateChannelConversation em alguns caminhos
 * =========================
 */
let __coreCache = null;
async function getConversationsCore() {
  if (__coreCache) return __coreCache;

  const attempts = [
    // ✅ padrão: mesmo diretório (src/routes/conversations.js)
    () => import("./conversations.js"),
    // ✅ fallback comum: core separado
    () => import("../core/conversationsCore.js"),
    // ✅ outro fallback possível (se você criou pasta conversations)
    () => import("../conversations/conversationsCore.js"),
  ];

  let lastErr = null;

  for (const fn of attempts) {
    try {
      const mod = await fn();
      const getOrCreateChannelConversation =
        mod?.getOrCreateChannelConversation || mod?.default?.getOrCreateChannelConversation;
      const appendMessage = mod?.appendMessage || mod?.default?.appendMessage;

      if (typeof getOrCreateChannelConversation === "function" && typeof appendMessage === "function") {
        __coreCache = { getOrCreateChannelConversation, appendMessage };
        return __coreCache;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  const msg =
    "Conversations core não encontrado. Garanta que exista export nomeado { getOrCreateChannelConversation, appendMessage } " +
    "em src/routes/conversations.js (ou em ../core/conversationsCore.js).";

  logger.error({ err: lastErr }, msg);
  throw new Error(msg);
}

/**
 * =========================
 * DB SHAPE (legado/compat)
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
      config: {},
    };
  }
  if (!db.chatbot) db.chatbot = {};
  return db;
}

/**
 * =========================
 * MULTI-TENANT CONFIG (Prisma com fallback)
 * =========================
 */
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
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

/**
 * ChannelConfig no Prisma (schema atual):
 * - tenantId
 * - channel (ex: "webchat")
 * - enabled
 * - status
 * - widgetKey
 * - config (Json)  -> aqui vamos guardar allowedOrigins e config do widget
 *
 * Exemplo config JSON:
 * {
 *   "allowedOrigins": ["https://site.com"],
 *   "widget": { "color": "#34d399", ... }
 * }
 */
async function getWebchatConfig(req) {
  const tenantId = req.tenant?.id || null;

  // Preferencial: por tenant no Postgres
  if (tenantId) {
    try {
      const row = await prisma.channelConfig.findFirst({
        where: { tenantId, channel: "webchat" },
        select: { enabled: true, widgetKey: true, status: true, config: true },
      });

      if (!row) {
        return { enabled: false, widgetKey: "", allowedOrigins: [], config: {} };
      }

      const cfg = row?.config && typeof row.config === "object" ? row.config : {};
      const allowedOrigins = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];

      // widget config pode estar em cfg.widget ou direto no cfg
      const widgetConfig =
        (cfg.widget && typeof cfg.widget === "object" ? cfg.widget : null) || cfg || {};

      return {
        enabled: row.enabled !== false,
        widgetKey: String(row.widgetKey || "").trim(),
        allowedOrigins,
        config: widgetConfig,
      };
    } catch (e) {
      logger.warn({ e }, "webchat: prisma indisponível, usando fallback legacy");
      // cai no legacy abaixo
    }
  }

  // Fallback legacy (single-tenant JSON)
  const db = ensureDbShape(loadDB());
  const webchat = db?.settings?.channels?.webchat || {};

  return {
    enabled: webchat.enabled !== false,
    widgetKey: String(webchat.widgetKey || "").trim(),
    allowedOrigins: Array.isArray(webchat.allowedOrigins) ? webchat.allowedOrigins : [],
    config: webchat.config || {},
  };
}

function readWidgetKey(req) {
  const h = String(req.headers["x-widget-key"] || "").trim();
  if (h) return h;
  return String(req.query.widgetKey || req.query.widget_key || "").trim();
}

function isOriginAllowed(origin, allowedOrigins) {
  // server-to-server (sem origin)
  if (!origin) return true;

  const allowed = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(normalizeOrigin).filter(Boolean)
    : [];

  if (!allowed.length) return false;
  return allowed.includes(normalizeOrigin(origin));
}

async function assertWebchatAllowed(req, { requireWidgetKey = true } = {}) {
  const cfg = await getWebchatConfig(req);

  if (cfg.enabled === false) {
    return { ok: false, status: 403, error: "WebChat desativado" };
  }

  const origin = getRequestOrigin(req);
  if (!isOriginAllowed(origin, cfg.allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: "Origin não permitido",
      details: { origin, allowedOrigins: cfg.allowedOrigins },
    };
  }

  if (requireWidgetKey) {
    const configuredKey = String(cfg.widgetKey || "").trim();
    if (!configuredKey) {
      return { ok: false, status: 500, error: "WebChat não configurado (widgetKey ausente)." };
    }

    const key = readWidgetKey(req);
    if (!key || key !== configuredKey) {
      return { ok: false, status: 403, error: "widgetKey inválida ou ausente" };
    }
  }

  return { ok: true, cfg };
}

/**
 * =========================
 * AUTH HELPERS (token do widget)
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
  return jwt.verify(token, getWebchatJwtSecret());
}

/**
 * =========================
 * CORS (WEBCHAT) - redundância segura
 * =========================
 */
async function setCorsHeaders(req, res) {
  const cfg = await getWebchatConfig(req);
  const origin = normalizeOrigin(req.headers.origin || "");

  if (origin && isOriginAllowed(origin, cfg.allowedOrigins)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Widget-Key, X-Webchat-Token, X-Tenant-Id"
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

  const history = (db.messagesByConversation?.[String(conv.id)] || []).slice(-10);

  let botText = "";
  try {
    if (typeof botEngine === "function") {
      botText = await botEngine({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: history,
      });
    } else {
      botText = await botEngine.run({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: history,
      });
    }
  } catch {
    return { ok: true, didBot: false };
  }

  botText = String(botText || "").trim();
  if (!botText) return { ok: true, didBot: false };

  const { appendMessage } = await getConversationsCore();

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    direction: "out",
    text: botText,
    createdAt: nowIso(),
    tenantId: conv.tenantId || null,
    isBot: true,
  });

  return r?.ok ? { ok: true, didBot: true, botMessage: r.msg } : { ok: false, didBot: false };
}

/**
 * =========================
 * MULTI-TENANT GUARDA
 * =========================
 */
function requireTenant(req, res) {
  if (!req.tenant?.id) {
    res.status(400).json({ error: "missing_tenant_context" });
    return false;
  }
  return true;
}

function getConversationOr404(db, id, tenantId) {
  const conv = db.conversations.find((c) => String(c.id) === String(id)) || null;
  if (!conv) return null;

  // multi-tenant guard (quando existir tenantId na conversa)
  if (tenantId && conv.tenantId && String(conv.tenantId) !== String(tenantId)) return null;

  return conv;
}

/**
 * =========================
 * ROUTES
 * =========================
 */

// ✅ Preflight completo
router.options("*", async (req, res) => {
  try {
    await setCorsHeaders(req, res);
  } catch {}
  return res.status(204).end();
});

// ----------------------------------------------------
// POST /webchat/session
// body: { visitorId }
// headers: X-Widget-Key
// ----------------------------------------------------
router.post("/session", async (req, res) => {
  if (!requireTenant(req, res)) return;

  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  await setCorsHeaders(req, res);

  const allow = await assertWebchatAllowed(req, { requireWidgetKey: true });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const db = ensureDbShape(loadDB());
  const initialMode = isWebchatBotEnabled(db) ? "bot" : "human";

  // ✅ separação por tenant no peerId + salva tenantId na conversa
  const peerId = `wc:${req.tenant.id}:${visitorId}`;

  const { getOrCreateChannelConversation } = await getConversationsCore();

  const r = getOrCreateChannelConversation(db, {
    source: "webchat",
    peerId,
    visitorId,
    title: `WebChat ${String(visitorId).slice(0, 6)}`,
    currentMode: initialMode,
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao criar sessão" });

  // ✅ marca tenant na conversa
  r.conversation.tenantId = req.tenant.id;

  const token = jwt.sign(
    {
      tenantId: req.tenant.id,
      conversationId: r.conversation.id,
      visitorId,
      source: "webchat",
      iat: nowUnix(),
      exp: nowUnix() + TOKEN_TTL_SECONDS,
    },
    getWebchatJwtSecret()
  );

  saveDB(db);

  return res.json({
    conversationId: r.conversation.id,
    webchatToken: token,
    status: r.conversation.status,
    currentMode: r.conversation.currentMode,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
});

// ----------------------------------------------------
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// ----------------------------------------------------
router.get("/conversations/:id/messages", async (req, res) => {
  if (!requireTenant(req, res)) return;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (String(decoded?.tenantId || "") !== String(req.tenant.id)) {
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const { id } = req.params;

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  await setCorsHeaders(req, res);

  const allow = await assertWebchatAllowed(req, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const db = ensureDbShape(loadDB());

  const conv = getConversationOr404(db, id, req.tenant.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  const all = Array.isArray(db.messagesByConversation?.[String(id)])
    ? db.messagesByConversation[String(id)]
    : [];

  const allTenant = all.filter((m) => !m?.tenantId || String(m.tenantId) === String(req.tenant.id));

  let items = allTenant;

  if (after) {
    const idx = allTenant.findIndex((m) => String(m.id) === String(after));
    if (idx >= 0) items = allTenant.slice(idx + 1);
    else items = allTenant.filter((m) => String(m.createdAt || "") > after);
  }

  items = items.slice(0, limit);

  const last = items.length ? items[items.length - 1] : null;
  const nextCursor = last ? last.id || last.createdAt : after || null;

  return res.json({ items, nextCursor });
});

// ----------------------------------------------------
// POST /webchat/messages
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// body: { text }
// ----------------------------------------------------
router.post("/messages", async (req, res) => {
  if (!requireTenant(req, res)) return;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (String(decoded?.tenantId || "") !== String(req.tenant.id)) {
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const cleanText = String(req.body?.text || "").trim();
  if (!cleanText) return res.status(400).json({ error: "Mensagem vazia" });

  await setCorsHeaders(req, res);

  const allow = await assertWebchatAllowed(req, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const db = ensureDbShape(loadDB());

  const conv = getConversationOr404(db, decoded.conversationId, req.tenant.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }
  if (String(conv.status) !== "open") return res.status(410).json({ error: "Conversa encerrada" });

  conv.tenantId = conv.tenantId || req.tenant.id;

  const { appendMessage } = await getConversationsCore();

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso(),
    tenantId: req.tenant.id,
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao salvar mensagem" });

  const bot = await maybeReplyWithBot(db, conv, cleanText);

  saveDB(db);

  return res.json({
    ok: true,
    message: r.msg,
    nextCursor: r.msg?.id,
    bot: bot?.didBot ? { message: bot.botMessage } : null,
  });
});

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// ----------------------------------------------------
router.post("/conversations/:id/close", async (req, res) => {
  if (!requireTenant(req, res)) return;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (String(decoded?.tenantId || "") !== String(req.tenant.id)) {
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const { id } = req.params;

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  await setCorsHeaders(req, res);

  const allow = await assertWebchatAllowed(req, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const db = ensureDbShape(loadDB());

  const conv = getConversationOr404(db, id, req.tenant.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  conv.tenantId = conv.tenantId || req.tenant.id;

  if (String(conv.status) === "closed") {
    saveDB(db);
    return res.json({ ok: true, status: "closed" });
  }

  conv.status = "closed";
  conv.updatedAt = nowIso();
  conv.closedAt = nowIso();
  conv.closedReason = "webchat_widget_close";

  const { appendMessage } = await getConversationsCore();

  appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "system",
    from: "system",
    direction: "out",
    text: "Conversa encerrada.",
    createdAt: nowIso(),
    tenantId: req.tenant.id,
    isSystem: true,
  });

  saveDB(db);
  return res.json({ ok: true, status: "closed" });
});

export default router;
