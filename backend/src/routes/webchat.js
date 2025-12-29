// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

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
 * Helpers base
 * =========================
 */
function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

function toBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  if (v == null) return false;

  if (typeof v === "number") return v === 1;

  const s = String(v).trim().toLowerCase();
  return ["1", "true", "yes", "y", "on", "sim"].includes(s);
}

function mergeMeta(oldMeta, patch) {
  return { ...asJson(oldMeta), ...asJson(patch) };
}

/**
 * =========================
 * JWT SECRET (SEM fallback inseguro em produção)
 * =========================
 */
function getWebchatJwtSecret() {
  const secret = process.env.WEBCHAT_JWT_SECRET || process.env.JWT_SECRET;

  if (!secret || !String(secret).trim()) {
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
 * =========================
 */
let __coreCache = null;
async function getConversationsCore() {
  if (__coreCache) return __coreCache;

  const attempts = [
    () => import("./conversations.js"),
    () => import("../core/conversationsCore.js"),
    () => import("../conversations/conversationsCore.js")
  ];

  let lastErr = null;

  for (const fn of attempts) {
    try {
      const mod = await fn();
      const getOrCreateChannelConversation =
        mod?.getOrCreateChannelConversation || mod?.default?.getOrCreateChannelConversation;
      const appendMessage = mod?.appendMessage || mod?.default?.appendMessage;

      if (
        typeof getOrCreateChannelConversation === "function" &&
        typeof appendMessage === "function"
      ) {
        __coreCache = { getOrCreateChannelConversation, appendMessage };
        return __coreCache;
      }
    } catch (e) {
      lastErr = e;
    }
  }

  const msg =
    "Conversations core não encontrado. Garanta exports { getOrCreateChannelConversation, appendMessage } " +
    "em src/routes/conversations.js (ou em ../core/conversationsCore.js).";

  logger.error({ err: lastErr }, msg);
  throw new Error(msg);
}

/**
 * =========================
 * ORIGIN + CORS
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

function isOriginAllowed(origin, allowedOrigins) {
  // server-to-server (sem origin)
  if (!origin) return true;

  const allowed = Array.isArray(allowedOrigins)
    ? allowedOrigins.map(normalizeOrigin).filter(Boolean)
    : [];

  if (!allowed.length) return false;
  return allowed.includes(normalizeOrigin(origin));
}

function readWidgetKey(req) {
  const h = String(req.headers["x-widget-key"] || "").trim();
  if (h) return h;
  return String(req.query.widgetKey || req.query.widget_key || "").trim();
}

/**
 * =========================
 * WEBCHAT CONFIG (Prisma only)
 * =========================
 */
async function getWebchatConfig(tenantId) {
  if (!tenantId) {
    return {
      enabled: false,
      widgetKey: "",
      allowedOrigins: [],
      config: {},
      botEnabled: false
    };
  }

  const row = await prisma.channelConfig.findFirst({
    where: { tenantId, channel: "webchat" },
    select: { enabled: true, widgetKey: true, status: true, config: true }
  });

  if (!row) {
    return {
      enabled: false,
      widgetKey: "",
      allowedOrigins: [],
      config: {},
      botEnabled: false
    };
  }

  const cfg = row?.config && typeof row.config === "object" ? row.config : {};
  const allowedOrigins = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];

  // prioriza cfg.widget, mas aceita cfg direto
  const widgetConfig =
    (cfg.widget && typeof cfg.widget === "object" ? cfg.widget : null) || cfg || {};

  // ✅ IMPORTANTÍSSIMO: tolerante a string "true"
  const botEnabled = toBool(cfg.botEnabled);

  return {
    enabled: row.enabled !== false,
    widgetKey: String(row.widgetKey || "").trim(),
    allowedOrigins,
    config: widgetConfig,
    botEnabled
  };
}

/**
 * =========================
 * CORS Headers (sempre responde)
 * - inclui X-Tenant-Slug (compat)
 * =========================
 */
async function setCorsHeaders(req, res, tenantId) {
  try {
    const cfg = await getWebchatConfig(tenantId);
    const origin = normalizeOrigin(req.headers.origin || "");
    if (origin && isOriginAllowed(origin, cfg.allowedOrigins)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
  } catch {}

  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    [
      "Content-Type",
      "Authorization",
      "X-Widget-Key",
      "X-Webchat-Token",
      "X-Tenant-Id",
      "X-Tenant-Slug"
    ].join(", ")
  );
  res.setHeader("Access-Control-Max-Age", "86400");
}

/**
 * =========================
 * AUTH (token do widget)
 * =========================
 */
function readAuthToken(req) {
  const authRaw = String(req.headers.authorization || "").trim();
  const auth = authRaw.toLowerCase();

  // remove corretamente, independente de maiúsculas
  if (auth.startsWith("webchat ")) {
    return authRaw.slice("webchat ".length).trim();
  }

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
 * TENANT RESOLUTION (webchat)
 * =========================
 */
async function resolveTenantContext(req) {
  if (req.tenant?.id) {
    return { tenantId: String(req.tenant.id), tenant: req.tenant, from: "req.tenant" };
  }

  const tenantId = String(req.headers["x-tenant-id"] || req.query.tenantId || "").trim();
  if (tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (t?.isActive) {
      req.tenant = t;
      req.tenantId = t.id;
      return { tenantId: String(t.id), tenant: t, from: "x-tenant-id" };
    }
  }

  const slug = String(req.headers["x-tenant-slug"] || req.query.tenant || "").trim();
  if (slug) {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    if (t?.isActive) {
      req.tenant = t;
      req.tenantId = t.id;
      return { tenantId: String(t.id), tenant: t, from: "x-tenant-slug" };
    }
  }

  // token (para rotas tokenadas)
  const token = readAuthToken(req);
  if (token) {
    try {
      const decoded = jwt.verify(token, getWebchatJwtSecret());
      const tid = String(decoded?.tenantId || "").trim();
      if (tid) {
        const t = await prisma.tenant.findUnique({ where: { id: tid } });
        if (t?.isActive) {
          req.tenant = t;
          req.tenantId = t.id;
          return { tenantId: String(t.id), tenant: t, from: "jwt" };
        }
      }
    } catch {}
  }

  return { tenantId: null, tenant: null, from: "none" };
}

/**
 * =========================
 * WEBCHAT ALLOW (enabled + origin + widgetKey)
 * =========================
 */
async function assertWebchatAllowed(req, tenantId, { requireWidgetKey = true } = {}) {
  const cfg = await getWebchatConfig(tenantId);

  if (cfg.enabled === false) {
    return { ok: false, status: 403, error: "WebChat desativado" };
  }

  const origin = getRequestOrigin(req);
  if (!isOriginAllowed(origin, cfg.allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: "Origin não permitido",
      details: { origin, allowedOrigins: cfg.allowedOrigins }
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
 * BOT helpers
 * =========================
 */
async function getLastMessagesForBot({ tenantId, conversationId, take = 10 }) {
  const rows = await prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take
  });

  return rows.map((m) => ({
    id: String(m.id),
    type: String(m.type || "text"),
    direction: String(m.direction || "in"),
    text: m.text || "",
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
    metadata: m.metadata || {}
  }));
}

async function loadBotInvoker() {
  // tenta casar com o que você já usa nos outros canais (callGenAIBot)
  try {
    const mod = await import("../chatbot/botEngine.js");

    if (typeof mod?.callGenAIBot === "function") {
      return async ({ tenantId, conversation, messageText, history }) =>
        mod.callGenAIBot({
          accountSettings: { tenantId, channel: "webchat" },
          conversation,
          messageText,
          history: Array.isArray(history) ? history : []
        });
    }

    // fallback: default export function
    const fn = mod?.default;
    if (typeof fn === "function") {
      return async ({ conversation, messageText, history }) =>
        fn({
          channel: "webchat",
          conversation,
          userText: messageText,
          messages: Array.isArray(history) ? history : []
        });
    }

    // fallback: botEngine.run
    const be = mod?.botEngine || mod;
    if (typeof be?.run === "function") {
      return async ({ conversation, messageText, history }) =>
        be.run({
          channel: "webchat",
          conversation,
          userText: messageText,
          messages: Array.isArray(history) ? history : []
        });
    }
  } catch (e) {
    logger.warn({ err: String(e) }, "⚠️ webchat: falha ao importar botEngine");
  }

  return null;
}

function parseBotReplyToText(botReply) {
  if (!botReply) return "";
  if (typeof botReply === "string") return safeStr(botReply);
  if (typeof botReply?.replyText === "string") return safeStr(botReply.replyText);
  if (typeof botReply?.text === "string") return safeStr(botReply.text);
  return safeStr(botReply?.message || "");
}

async function maybeReplyWithBot({ tenantId, convRow, cleanText }) {
  const convMeta = asJson(convRow?.metadata);

  if (String(convRow?.status || "") !== "open") {
    logger.info({ tenantId, convId: convRow?.id }, "🤖 webchat: skip bot (status != open)");
    return { ok: true, didBot: false };
  }

  const mode = String(convMeta.currentMode || convRow?.currentMode || "").toLowerCase();
  if (mode === "human") {
    logger.info({ tenantId, convId: convRow?.id }, "🤖 webchat: skip bot (mode=human)");
    return { ok: true, didBot: false };
  }

  // botEnabled per webchat config (tolerante)
  let botEnabled = false;
  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId, channel: "webchat" },
      select: { config: true }
    });
    const c = row?.config && typeof row.config === "object" ? row.config : {};
    botEnabled = toBool(c.botEnabled);
  } catch {}

  if (!botEnabled) {
    logger.info({ tenantId, convId: convRow?.id }, "🤖 webchat: skip bot (botEnabled=false)");
    return { ok: true, didBot: false };
  }

  const invoker = await loadBotInvoker();
  if (!invoker) {
    logger.warn({ tenantId, convId: convRow?.id }, "⚠️ webchat: bot invoker não disponível");
    return { ok: true, didBot: false };
  }

  const history = await getLastMessagesForBot({
    tenantId,
    conversationId: convRow.id,
    take: 10
  });

  let botText = "";
  try {
    const botReply = await invoker({
      tenantId,
      conversation: convRow,
      messageText: cleanText,
      history
    });
    botText = parseBotReplyToText(botReply);
  } catch (e) {
    logger.warn({ err: String(e), tenantId, convId: convRow?.id }, "⚠️ webchat: bot exception");
    return { ok: true, didBot: false };
  }

  botText = String(botText || "").trim();
  if (!botText) {
    logger.info({ tenantId, convId: convRow?.id }, "🤖 webchat: bot retornou vazio");
    return { ok: true, didBot: false };
  }

  const { appendMessage } = await getConversationsCore();

  const r = await appendMessage(String(convRow.id), {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    direction: "out",
    text: botText,
    createdAt: nowIso(),
    tenantId,
    isBot: true
  });

  if (r?.ok) {
    logger.info({ tenantId, convId: convRow?.id }, "🤖 webchat: bot respondeu");
    return { ok: true, didBot: true, botMessage: r.msg };
  }

  logger.warn({ tenantId, convId: convRow?.id, err: r?.error }, "⚠️ webchat: falha ao salvar msg do bot");
  return { ok: false, didBot: false };
}

/**
 * =========================
 * ROUTES
 * =========================
 */

// Preflight
router.options("*", async (req, res) => {
  try {
    const ctx = await resolveTenantContext(req);
    await setCorsHeaders(req, res, ctx.tenantId);
  } catch {}
  return res.status(204).end();
});

// POST /webchat/session
router.post("/session", async (req, res) => {
  const ctx = await resolveTenantContext(req);
  const tenantId = ctx.tenantId;

  if (!tenantId) {
    await setCorsHeaders(req, res, null);
    return res.status(400).json({ error: "missing_tenant_context" });
  }

  const { visitorId } = req.body || {};
  if (!visitorId) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(400).json({ error: "visitorId obrigatório" });
  }

  await setCorsHeaders(req, res, tenantId);

  const allow = await assertWebchatAllowed(req, tenantId, { requireWidgetKey: true });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const { getOrCreateChannelConversation } = await getConversationsCore();

  const peerId = `wc:${tenantId}:${visitorId}`;

  // ✅ usa boolean já normalizado
  const initialMode = allow?.cfg?.botEnabled ? "bot" : "human";

  const r = await getOrCreateChannelConversation({
    tenantId,
    source: "webchat",
    peerId,
    visitorId,
    title: `WebChat ${String(visitorId).slice(0, 6)}`,
    currentMode: initialMode
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao criar sessão" });

  const token = jwt.sign(
    {
      tenantId,
      conversationId: r.conversation.id,
      visitorId,
      source: "webchat",
      iat: nowUnix(),
      exp: nowUnix() + TOKEN_TTL_SECONDS
    },
    getWebchatJwtSecret()
  );

  return res.json({
    conversationId: r.conversation.id,
    webchatToken: token,
    status: r.conversation.status,
    currentMode: r.conversation.currentMode,
    expiresInSeconds: TOKEN_TTL_SECONDS,
    widgetConfig: allow?.cfg?.config || {}
  });
});

// GET /webchat/conversations/:id/messages
router.get("/conversations/:id/messages", async (req, res) => {
  const ctx = await resolveTenantContext(req);
  const tenantId = ctx.tenantId;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const tokenTenantId = String(decoded?.tenantId || "");
  if (!tenantId || tokenTenantId !== tenantId) {
    await setCorsHeaders(req, res, tenantId || tokenTenantId || null);
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const { id } = req.params;

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  await setCorsHeaders(req, res, tenantId);

  const allow = await assertWebchatAllowed(req, tenantId, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const convRow = await prisma.conversation.findFirst({
    where: { id: String(id), tenantId }
  });

  if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

  const convMeta = asJson(convRow.metadata);
  const source = String(convMeta.source || convRow.channel || "").toLowerCase();
  if (source !== "webchat") return res.status(409).json({ error: "Conversa não pertence ao Webchat" });

  const query = {
    where: { tenantId, conversationId: convRow.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit
  };

  let rows = [];
  if (after) {
    try {
      rows = await prisma.message.findMany({ ...query, cursor: { id: after }, skip: 1 });
    } catch {
      rows = await prisma.message.findMany(query);
    }
  } else {
    rows = await prisma.message.findMany(query);
  }

  const items = rows.map((m) => ({
    id: String(m.id),
    conversationId: String(m.conversationId),
    type: String(m.type || "text"),
    direction: String(m.direction || "in"),
    text: m.text || "",
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
    metadata: m.metadata || {}
  }));

  const last = items.length ? items[items.length - 1] : null;
  const nextCursor = last ? last.id : after || null;

  return res.json({ items, nextCursor });
});

// POST /webchat/messages
router.post("/messages", async (req, res) => {
  const ctx = await resolveTenantContext(req);
  const tenantId = ctx.tenantId;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const tokenTenantId = String(decoded?.tenantId || "");
  if (!tenantId || tokenTenantId !== tenantId) {
    await setCorsHeaders(req, res, tenantId || tokenTenantId || null);
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const cleanText = String(req.body?.text || "").trim();
  if (!cleanText) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(400).json({ error: "Mensagem vazia" });
  }

  await setCorsHeaders(req, res, tenantId);

  const allow = await assertWebchatAllowed(req, tenantId, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const conversationId = String(decoded.conversationId || "").trim();
  if (!conversationId) return res.status(400).json({ error: "conversationId ausente no token" });

  const convRow = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId }
  });

  if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

  const convMeta = asJson(convRow.metadata);
  const source = String(convMeta.source || convRow.channel || "").toLowerCase();
  if (source !== "webchat") return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  if (String(convRow.status) !== "open") return res.status(410).json({ error: "Conversa encerrada" });

  const { appendMessage } = await getConversationsCore();

  const r = await appendMessage(conversationId, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso(),
    tenantId
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao salvar mensagem" });

  // bot opcional
  const bot = await maybeReplyWithBot({ tenantId, convRow, cleanText });

  return res.json({
    ok: true,
    message: r.msg,
    nextCursor: r.msg?.id,
    bot: bot?.didBot ? { message: bot.botMessage } : null
  });
});

// POST /webchat/handoff  (bot -> human)
router.post("/handoff", async (req, res) => {
  const ctx = await resolveTenantContext(req);
  const tenantId = ctx.tenantId;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const tokenTenantId = String(decoded?.tenantId || "");
  if (!tenantId || tokenTenantId !== tenantId) {
    await setCorsHeaders(req, res, tenantId || tokenTenantId || null);
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  await setCorsHeaders(req, res, tenantId);

  const allow = await assertWebchatAllowed(req, tenantId, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const conversationId = String(decoded?.conversationId || "").trim();
  if (!conversationId) return res.status(400).json({ error: "conversationId ausente no token" });

  const convRow = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId }
  });

  if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

  const convMeta = asJson(convRow.metadata);
  const source = String(convMeta.source || convRow.channel || "").toLowerCase();
  if (source !== "webchat") return res.status(409).json({ error: "Conversa não pertence ao Webchat" });

  const reason = String(req.body?.reason || "user_request").trim();

  const newMeta = mergeMeta(convRow.metadata, {
    currentMode: "human",
    handoffAt: nowIso(),
    handoffReason: reason
  });

  try {
    await prisma.conversation.update({
      where: { id: convRow.id },
      data: {
        currentMode: "human",
        updatedAt: new Date(),
        metadata: newMeta
      }
    });
  } catch {
    await prisma.conversation.update({
      where: { id: convRow.id },
      data: {
        updatedAt: new Date(),
        metadata: newMeta
      }
    });
  }

  const { appendMessage } = await getConversationsCore();
  await appendMessage(String(convRow.id), {
    channel: "webchat",
    source: "webchat",
    type: "system",
    from: "system",
    direction: "out",
    text: "Encaminhando você para um atendente humano…",
    createdAt: nowIso(),
    tenantId,
    isSystem: true
  });

  return res.json({ ok: true, conversationId: String(convRow.id), currentMode: "human" });
});

// POST /webchat/conversations/:id/close
router.post("/conversations/:id/close", async (req, res) => {
  const ctx = await resolveTenantContext(req);
  const tenantId = ctx.tenantId;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const tokenTenantId = String(decoded?.tenantId || "");
  if (!tenantId || tokenTenantId !== tenantId) {
    await setCorsHeaders(req, res, tenantId || tokenTenantId || null);
    return res.status(403).json({ error: "Token não pertence ao tenant" });
  }

  const { id } = req.params;

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    await setCorsHeaders(req, res, tenantId);
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  await setCorsHeaders(req, res, tenantId);

  const allow = await assertWebchatAllowed(req, tenantId, { requireWidgetKey: false });
  if (!allow.ok) {
    return res.status(allow.status).json({ error: allow.error, details: allow.details });
  }

  const convRow = await prisma.conversation.findFirst({
    where: { id: String(id), tenantId }
  });

  if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

  const convMeta = asJson(convRow.metadata);
  const source = String(convMeta.source || convRow.channel || "").toLowerCase();
  if (source !== "webchat") return res.status(409).json({ error: "Conversa não pertence ao Webchat" });

  if (String(convRow.status) === "closed") {
    return res.json({ ok: true, status: "closed" });
  }

  await prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      status: "closed",
      updatedAt: new Date(),
      metadata: mergeMeta(convRow.metadata, {
        closedAt: nowIso(),
        closedReason: "webchat_widget_close"
      })
    }
  });

  const { appendMessage } = await getConversationsCore();

  await appendMessage(String(convRow.id), {
    channel: "webchat",
    source: "webchat",
    type: "system",
    from: "system",
    direction: "out",
    text: "Conversa encerrada.",
    createdAt: nowIso(),
    tenantId,
    isSystem: true
  });

  return res.json({ ok: true, status: "closed" });
});

export default router;
