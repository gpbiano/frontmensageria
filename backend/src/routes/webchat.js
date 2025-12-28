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
 * ChannelConfig:
 * - tenantId
 * - channel="webchat"
 * - enabled
 * - widgetKey
 * - config: { allowedOrigins: [], botEnabled?: boolean, widget?: {...} }
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

  const botEnabled = cfg.botEnabled === true;

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
 * - IMPORTANTE: inclui X-Tenant-Slug também (pra compatibilidade)
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
  } catch {
    // não quebra a request se o config não carregar
  }

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
  const auth = String(req.headers.authorization || "");
  if (auth.toLowerCase().startsWith("webchat ")) return auth.slice("Webchat ".length).trim();

  const xToken = String(req.headers["x-webchat-token"] || "").trim();
  if (xToken) return xToken;

  const qToken = String(req.query.token || "").trim();
  if (qToken) return qToken;

  return "";
}

/**
 * Lê o token e devolve payload decodificado.
 * - Se inválido: lança erro.
 */
function verifyWebchatToken(req) {
  const token = readAuthToken(req);
  if (!token) throw new Error("Token ausente");
  return jwt.verify(token, getWebchatJwtSecret());
}

/**
 * =========================
 * TENANT RESOLUTION (webchat)
 * ✅ prioridade:
 * 1) req.tenant (resolvido por subdomínio)
 * 2) X-Tenant-Id / query tenantId
 * 3) X-Tenant-Slug / query tenant
 * 4) ✅ token (tenantId dentro do JWT)  -> resolve para /messages e endpoints tokenados
 * =========================
 */
async function resolveTenantContext(req) {
  // 1) já veio do resolveTenant global
  if (req.tenant?.id) {
    return { tenantId: String(req.tenant.id), tenant: req.tenant, from: "req.tenant" };
  }

  // 2) header/query tenantId
  const tenantId = String(req.headers["x-tenant-id"] || req.query.tenantId || "").trim();
  if (tenantId) {
    const t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (t?.isActive) {
      req.tenant = t;
      req.tenantId = t.id;
      return { tenantId: String(t.id), tenant: t, from: "x-tenant-id" };
    }
  }

  // 3) header/query slug
  const slug = String(req.headers["x-tenant-slug"] || req.query.tenant || "").trim();
  if (slug) {
    const t = await prisma.tenant.findUnique({ where: { slug } });
    if (t?.isActive) {
      req.tenant = t;
      req.tenantId = t.id;
      return { tenantId: String(t.id), tenant: t, from: "x-tenant-slug" };
    }
  }

  // 4) token (para rotas que já exigem token)
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
    } catch {
      // não seta tenant a partir de token inválido
    }
  }

  return { tenantId: null, tenant: null, from: "none" };
}

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

function mergeMeta(oldMeta, patch) {
  return { ...asJson(oldMeta), ...asJson(patch) };
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
 * BOT (opcional)
 * - habilitado por ChannelConfig.config.botEnabled === true
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

async function maybeReplyWithBot({ tenantId, convRow, cleanText }) {
  const convMeta = asJson(convRow?.metadata);
  if (String(convRow?.status || "") !== "open") return { ok: true, didBot: false };
  if (String(convMeta.currentMode || "") === "human") return { ok: true, didBot: false };

  // bot enabled per webchat config
  let cfg;
  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId, channel: "webchat" },
      select: { config: true }
    });
    const c = row?.config && typeof row.config === "object" ? row.config : {};
    cfg = { botEnabled: c.botEnabled === true };
  } catch {
    cfg = { botEnabled: false };
  }

  if (!cfg.botEnabled) return { ok: true, didBot: false };

  // carrega bot engine
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

  const history = await getLastMessagesForBot({
    tenantId,
    conversationId: convRow.id,
    take: 10
  });

  let botText = "";
  try {
    if (typeof botEngine === "function") {
      botText = await botEngine({
        channel: "webchat",
        conversation: convRow,
        userText: cleanText,
        messages: history
      });
    } else {
      botText = await botEngine.run({
        channel: "webchat",
        conversation: convRow,
        userText: cleanText,
        messages: history
      });
    }
  } catch {
    return { ok: true, didBot: false };
  }

  botText = String(botText || "").trim();
  if (!botText) return { ok: true, didBot: false };

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

  return r?.ok ? { ok: true, didBot: true, botMessage: r.msg } : { ok: false, didBot: false };
}

/**
 * =========================
 * ROUTES
 * =========================
 */

// ✅ Preflight completo
router.options("*", async (req, res) => {
  try {
    // tenta resolver tenant por headers/query pra conseguir allowedOrigins
    const ctx = await resolveTenantContext(req);
    await setCorsHeaders(req, res, ctx.tenantId);
  } catch {}
  return res.status(204).end();
});

// ----------------------------------------------------
// POST /webchat/session
// body: { visitorId }
// headers: X-Widget-Key
// ----------------------------------------------------
router.post("/session", async (req, res) => {
  // resolve tenant (host/header/query) — token ainda não existe aqui
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

  // separação por tenant no peerId
  const peerId = `wc:${tenantId}:${visitorId}`;

  const initialMode = allow?.cfg?.botEnabled === true ? "bot" : "human";

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

// ----------------------------------------------------
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// ----------------------------------------------------
router.get("/conversations/:id/messages", async (req, res) => {
  // aqui pode resolver tenant pelo token (mais confiável)
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
  if (source !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  const query = {
    where: { tenantId, conversationId: convRow.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit
  };

  let rows = [];
  if (after) {
    try {
      rows = await prisma.message.findMany({
        ...query,
        cursor: { id: after },
        skip: 1
      });
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

// ----------------------------------------------------
// POST /webchat/messages
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// body: { text }
// ----------------------------------------------------
router.post("/messages", async (req, res) => {
  // resolve tenant pelo token/headers
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

  const conversationId = String(decoded.conversationId || "");
  if (!conversationId) {
    return res.status(400).json({ error: "conversationId ausente no token" });
  }

  const convRow = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId }
  });

  if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

  const convMeta = asJson(convRow.metadata);
  const source = String(convMeta.source || convRow.channel || "").toLowerCase();
  if (source !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }
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

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// headers: Authorization: Webchat <token>  ou X-Webchat-Token
// ----------------------------------------------------
router.post("/conversations/:id/close", async (req, res) => {
  // resolve tenant pelo token/headers
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
  if (source !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

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
