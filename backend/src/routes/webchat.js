// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
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

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}
function mergeMeta(oldMeta, patch) {
  return { ...asJson(oldMeta), ...asJson(patch) };
}
function safeStr(v) {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
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
function resolveBotEnabledFromConfig(cfgObj) {
  const cfg = asJson(cfgObj);
  // aceita tanto config.botEnabled quanto config.widget.botEnabled
  if (cfg.botEnabled === true) return true;
  if (asJson(cfg.widget).botEnabled === true) return true;
  return false;
}

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

  const botEnabled = resolveBotEnabledFromConfig(cfg);

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
      "X-Tenant-Slug",
      "X-Idempotency-Key"
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
function getModeFromConversation(convRow) {
  const meta = asJson(convRow?.metadata);
  return String(meta.currentMode || convRow?.currentMode || "").toLowerCase();
}

function isRealHumanHandoff(convRow) {
  const meta = asJson(convRow?.metadata);

  // ✅ se teve handoff/humano de verdade, NÃO auto-retorna
  const hadHuman = meta.hadHuman === true;
  const handoffActive = meta.handoffActive === true || convRow?.handoffActive === true || false;
  const inboxVisible = meta.inboxVisible === true || convRow?.inboxVisible === true || false;

  // ✅ NOVO: se alguém pediu humano (mesmo que ainda ninguém tenha atendido)
  const handoffRequestedAt = !!meta.handoffRequestedAt;
  const handoffAt = !!meta.handoffAt || !!meta.handoffSince;

  return hadHuman || handoffActive || inboxVisible || handoffRequestedAt || handoffAt;
}

/**
 * Auto-return: se ficou "human" por acidente (ex: antes botEnabled era false),
 * volta pra "bot" para permitir resposta no widget.
 */
async function autoReturnHumanToBotIfNeeded({ tenantId, convRow, botEnabled }) {
  const convId = String(convRow?.id || "");
  if (!convId) return convRow;

  const mode = getModeFromConversation(convRow);
  if (mode !== "human") return convRow;
  if (!botEnabled) return convRow;

  // ✅ se é handoff real (ou solicitado), não mexe
  if (isRealHumanHandoff(convRow)) {
    logger.info({ tenantId, convId, msg: "🤖 webchat: keep mode=human (real handoff/requested)" });
    return convRow;
  }

  const newMeta = mergeMeta(convRow.metadata, {
    currentMode: "bot",
    autoReturnedAt: nowIso()
  });

  try {
    await prisma.conversation.update({
      where: { id: convId },
      data: {
        currentMode: "bot",
        updatedAt: new Date(),
        metadata: newMeta
      }
    });
  } catch {
    await prisma.conversation.update({
      where: { id: convId },
      data: {
        updatedAt: new Date(),
        metadata: newMeta
      }
    });
  }

  logger.info({ tenantId, convId, msg: "🤖 webchat: auto-returned mode human -> bot" });

  return prisma.conversation.findFirst({ where: { id: convId, tenantId } });
}

async function getLastMessagesForBot({ tenantId, conversationId, take = 12 }) {
  // pega as últimas (não as primeiras) para contexto melhor
  const rows = await prisma.message.findMany({
    where: { tenantId, conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take
  });

  const ordered = rows.slice().reverse();

  // transforma para formato {role, content} compatível com botEngine(callGenAIBot)
  return ordered
    .map((m) => {
      const meta = asJson(m.metadata);
      const isBot = meta.isBot === true || meta.from === "bot" || m.direction === "out";
      const isSystem = m.type === "system" || meta.isSystem === true || meta.from === "system";
      const role = isSystem ? "system" : isBot ? "assistant" : "user";
      const content = safeStr(m.text);
      if (!content) return null;
      return { role, content };
    })
    .filter(Boolean);
}

function wantsHumanFromText(txt) {
  const t = safeStr(txt).toLowerCase();
  if (!t) return false;
  return (
    t === "humano" ||
    t === "atendente" ||
    t.includes("falar com humano") ||
    t.includes("atendimento humano") ||
    t.includes("quero um atendente") ||
    t.includes("quero falar com atendente") ||
    t.includes("me transfere") ||
    t.includes("transferir para atendente")
  );
}

async function markHandoff({ tenantId, convRow, reason = "user_request" }) {
  const convId = String(convRow?.id || "");
  if (!convId) return { ok: false };

  const newMeta = mergeMeta(convRow.metadata, {
    currentMode: "human",
    hadHuman: true,
    handoffActive: true,
    handoffRequestedAt: nowIso(), // ✅ trava auto-return
    handoffAt: nowIso(),
    handoffReason: String(reason || "user_request"),
    inboxVisible: true,
    inboxStatus: "waiting_human",
    queuedAt: nowIso()
  });

  try {
    await prisma.conversation.update({
      where: { id: convId },
      data: {
        currentMode: "human",
        handoffActive: true,
        inboxVisible: true,
        updatedAt: new Date(),
        metadata: newMeta
      }
    });
  } catch {
    await prisma.conversation.update({
      where: { id: convId },
      data: { updatedAt: new Date(), metadata: newMeta }
    });
  }

  const { appendMessage } = await getConversationsCore();
  await appendMessage(convId, {
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

  return { ok: true };
}

function getClientMsgId(req) {
  // prioridade: corpo > header > fallback
  const fromBody =
    req.body?.clientMsgId ||
    req.body?.clientMessageId ||
    req.body?.messageId ||
    req.body?.idempotencyKey;

  const fromHeader = req.headers["x-idempotency-key"];

  const v = safeStr(fromBody || fromHeader || "");
  if (v) return v;

  // fallback: ainda ajuda dedupe quando o widget manda 2x (mesma janela)
  // (não garante idempotência perfeita, mas reduz duplicação)
  return `wc_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

async function maybeReplyWithBot({ tenantId, convRow, cleanText }) {
  const convId = String(convRow?.id || "");
  if (!convId) return { ok: true, didBot: false };

  // status aberto
  if (String(convRow?.status || "") !== "open") return { ok: true, didBot: false };

  // se handoff real/solicitado, não responde
  if (isRealHumanHandoff(convRow) || getModeFromConversation(convRow) === "human") {
    logger.info({ tenantId, convId, msg: "🤖 webchat: skip bot (handoff/mode=human)" });
    return { ok: true, didBot: false };
  }

  // lê config atual
  const webCfg = await getWebchatConfig(tenantId);
  logger.info({
    tenantId,
    convId,
    botEnabled: webCfg.botEnabled,
    hasConfig: true,
    msg: "🤖 webchat: bot config"
  });

  if (!webCfg.botEnabled) {
    logger.info({ tenantId, convId, msg: "🤖 webchat: bot disabled (botEnabled=false)" });
    return { ok: true, didBot: false };
  }

  // ✅ garante auto-return se human acidental (e não foi handoff)
  const fixedConv = await autoReturnHumanToBotIfNeeded({
    tenantId,
    convRow,
    botEnabled: webCfg.botEnabled
  });

  if (!fixedConv) return { ok: true, didBot: false };

  const fixedMode = getModeFromConversation(fixedConv);
  if (fixedMode === "human") {
    logger.info({ tenantId, convId, msg: "🤖 webchat: skip bot (mode=human)" });
    return { ok: true, didBot: false };
  }

  // ✅ Usa o botEngine real do projeto (callGenAIBot)
  let callGenAIBot;
  try {
    const mod = await import("../chatbot/botEngine.js");
    callGenAIBot = mod?.callGenAIBot || mod?.default?.callGenAIBot;
  } catch (e) {
    logger.warn(
      { tenantId, convId, err: String(e?.message || e) },
      "🤖 webchat: botEngine import fail"
    );
    return { ok: true, didBot: false };
  }

  if (typeof callGenAIBot !== "function") {
    logger.warn({ tenantId, convId }, "🤖 webchat: botEngine inválido");
    return { ok: true, didBot: false };
  }

  const history = await getLastMessagesForBot({
    tenantId,
    conversationId: fixedConv.id,
    take: 12
  });

  let replyText = "";
  try {
    // accountSettings opcional (se você tiver tabela/config depois, pluga aqui)
    const accountSettings = {};
    const r = await callGenAIBot({
      accountSettings,
      conversation: fixedConv,
      messageText: cleanText,
      history
    });

    replyText = safeStr(r?.replyText || "");
  } catch (e) {
    logger.warn({ tenantId, convId, err: String(e?.message || e) }, "🤖 webchat: botEngine run fail");
    return { ok: true, didBot: false };
  }

  if (!replyText) {
    logger.info({ tenantId, convId, msg: "🤖 webchat: empty bot reply" });
    return { ok: true, didBot: false };
  }

  const { appendMessage } = await getConversationsCore();

  const r2 = await appendMessage(String(fixedConv.id), {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    direction: "out",
    text: replyText,
    createdAt: nowIso(),
    tenantId,
    isBot: true
  });

  if (r2?.ok) {
    logger.info({ tenantId, convId, msg: "🤖 webchat: bot replied" });
    return { ok: true, didBot: true, botMessage: r2.msg };
  }

  logger.warn(
    { tenantId, convId, err: r2?.error || "appendMessage_failed" },
    "🤖 webchat: append bot failed"
  );
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

  // ✅ se o usuário pedir humano, abre handoff e NÃO chama bot
  if (wantsHumanFromText(cleanText)) {
    await markHandoff({ tenantId, convRow, reason: "typed_humano" });
    return res.json({
      ok: true,
      handoff: true,
      currentMode: "human",
      message: null,
      bot: null
    });
  }

  const { appendMessage } = await getConversationsCore();

  // ✅ idempotência / dedupe: manda clientMsgId para o core (precisa do patch no appendMessage)
  const clientMsgId = getClientMsgId(req);

  const r = await appendMessage(conversationId, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso(),
    tenantId,
    clientMsgId
  });

  if (!r?.ok) return res.status(400).json({ error: r.error || "Falha ao salvar mensagem" });

  // ✅ refetch para pegar metadata/currentMode atualizados
  const convFresh = await prisma.conversation.findFirst({
    where: { id: conversationId, tenantId }
  });

  // bot opcional
  const bot = await maybeReplyWithBot({ tenantId, convRow: convFresh || convRow, cleanText });

  return res.json({
    ok: true,
    message: r.msg,
    nextCursor: r.msg?.id,
    bot: bot?.didBot ? { message: bot.botMessage } : null
  });
});

// POST /webchat/handoff  (widget -> human)
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

  await markHandoff({ tenantId, convRow, reason });

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
        closedReason: "webchat_widget_close",
        handoffActive: false
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
