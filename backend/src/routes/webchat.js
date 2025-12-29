// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

// ✅ Alinha com os outros canais
import { decideRoute } from "../chatbot/rulesEngine.js";
import { callGenAIBot } from "../chatbot/botEngine.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

const TOKEN_TTL_SECONDS = 60 * 60; // 1h

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}
function nowIso() {
  return new Date().toISOString();
}
function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}
function asJson(v) {
  return v && typeof v === "object" ? v : {};
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
      logger.warn("⚠️ WEBCHAT_JWT_SECRET/JWT_SECRET ausente. Usando secret dev APENAS em development.");
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

      if (typeof getOrCreateChannelConversation === "function" && typeof appendMessage === "function") {
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
    return { enabled: false, widgetKey: "", allowedOrigins: [], config: {}, botEnabled: false };
  }

  const row = await prisma.channelConfig.findFirst({
    where: { tenantId, channel: "webchat" },
    select: { enabled: true, widgetKey: true, status: true, config: true }
  });

  if (!row) {
    return { enabled: false, widgetKey: "", allowedOrigins: [], config: {}, botEnabled: false };
  }

  const cfg = row?.config && typeof row.config === "object" ? row.config : {};
  const allowedOrigins = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];

  // prioriza cfg.widget, mas aceita cfg direto
  const widgetConfig =
    (cfg.widget && typeof cfg.widget === "object" ? cfg.widget : null) || cfg || {};

  // ✅ Regra consistente: botEnabled true somente quando explicitamente true
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
 * BOT HELPERS
 * =========================
 */
async function getLastMessagesForBot({ tenantId, conversationId, take = 10 }) {
  // ✅ pega as ÚLTIMAS mensagens (desc) e retorna em ordem cronológica (asc)
  const rows = await prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.max(1, Math.min(Number(take) || 10, 50))
  });

  const ordered = rows.slice().reverse();

  return ordered.map((m) => ({
    id: String(m.id),
    type: String(m.type || "text"),
    direction: String(m.direction || "in"),
    text: m.text || "",
    createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
    metadata: m.metadata || {}
  }));
}

function isConvInHumanMode(convRow) {
  const meta = asJson(convRow?.metadata);
  const mode = String(meta.currentMode || convRow?.currentMode || "").toLowerCase();
  const inboxVisible =
    typeof convRow?.inboxVisible === "boolean"
      ? convRow.inboxVisible
      : typeof meta.inboxVisible === "boolean"
      ? meta.inboxVisible
      : false;
  const handoffActive =
    typeof convRow?.handoffActive === "boolean"
      ? convRow.handoffActive
      : typeof meta.handoffActive === "boolean"
      ? meta.handoffActive
      : false;

  if (mode === "human") return true;
  if (handoffActive) return true;
  if (inboxVisible) return true;
  return false;
}

async function maybeReplyWithBot({ tenantId, convRow, cleanText }) {
  try {
    if (!tenantId || !convRow?.id) return { ok: true, didBot: false };
    if (String(convRow?.status || "") !== "open") return { ok: true, didBot: false };
    if (!cleanText) return { ok: true, didBot: false };

    if (isConvInHumanMode(convRow)) {
      return { ok: true, didBot: false };
    }

    const webCfg = await getWebchatConfig(tenantId);
    if (webCfg.botEnabled !== true) {
      return { ok: true, didBot: false };
    }

    const { appendMessage } = await getConversationsCore();

    // ✅ decideRoute igual aos outros canais
    const accountSettings = { channel: "webchat", tenantId };

    const decision = await decideRoute({
      accountSettings,
      conversation: convRow,
      messageText: cleanText
    });

    // HANDOFF
    if (decision?.target && decision.target !== "bot") {
      const handoffText =
        safeStr(webCfg?.config?.handoffMessage) ||
        "Aguarde um momento, vou te transferir para um atendente humano.";

      const r = await appendMessage(String(convRow.id), {
        tenantId,
        channel: "webchat",
        source: "webchat",
        type: "text",
        from: "bot",
        isBot: true,
        direction: "out",
        text: handoffText,
        createdAt: nowIso(),
        handoff: true,
        payload: { kind: "handoff", decision }
      });

      return r?.ok ? { ok: true, didBot: true, botMessage: r.msg, handoff: true } : { ok: false, didBot: false };
    }

    // BOT
    const history = await getLastMessagesForBot({
      tenantId,
      conversationId: String(convRow.id),
      take: 10
    });

    let botText = "";
    try {
      const botReply = await callGenAIBot({
        accountSettings,
        conversation: { ...convRow, id: String(convRow.id) },
        messageText: cleanText,
        history
      });

      // normaliza pra texto
      if (typeof botReply === "string") botText = botReply;
      else if (typeof botReply?.replyText === "string") botText = botReply.replyText;
      else if (typeof botReply?.text === "string") botText = botReply.text;
      else botText = String(botReply?.message || "");
    } catch (e) {
      logger.warn({ err: String(e), tenantId, conversationId: String(convRow.id) }, "⚠️ webchat callGenAIBot falhou");
      botText = "";
    }

    botText = safeStr(botText);
    if (!botText) botText = "Entendi. Pode me dar mais detalhes?";

    const r2 = await appendMessage(String(convRow.id), {
      tenantId,
      channel: "webchat",
      source: "webchat",
      type: "text",
      from: "bot",
      isBot: true,
      direction: "out",
      text: botText,
      createdAt: nowIso(),
      payload: { kind: "bot" }
    });

    return r2?.ok ? { ok: true, didBot: true, botMessage: r2.msg } : { ok: false, didBot: false };
  } catch (e) {
    logger.warn({ err: String(e), tenantId, conversationId: String(convRow?.id || "") }, "⚠️ webchat maybeReplyWithBot exception");
    return { ok: true, didBot: false };
  }
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

  // ✅ BOT (agora usando o mesmo pipeline dos outros canais)
  const bot = await maybeReplyWithBot({ tenantId, convRow, cleanText });

  return res.json({
    ok: true,
    message: r.msg,
    nextCursor: r.msg?.id,
    bot: bot?.didBot ? { message: bot.botMessage, handoff: bot?.handoff === true } : null
  });
});

// ✅ POST /webchat/handoff  (bot -> human)
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

