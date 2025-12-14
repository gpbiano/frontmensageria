// backend/src/index.js

// ===============================
// IMPORTS (core/libs)
// ===============================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";
import webchatRouter from "./routes/webchat.js";
import channelsRouter from "./routes/channels.js";


// ===============================
// ENV – CARREGAR .env.{ENV} ANTES DE IMPORTAR ROUTERS
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";
const envFile = `.env.${ENV}`;

dotenv.config({
  path: path.join(process.cwd(), envFile)
});

// agora que env carregou, podemos importar módulos internos
const { default: logger } = await import("./logger.js");

// Routers
const { default: chatbotRouter } = await import("./chatbot/chatbotRouter.js");
const { default: humanRouter } = await import("./human/humanRouter.js");
const { default: assignmentRouter } = await import("./human/assignmentRouter.js");

// ✅ Settings
const { default: usersRouter } = await import("./settings/usersRouter.js");
const { default: groupsRouter } = await import("./settings/groupsRouter.js");

// ✅ Auth
const { default: passwordRouter } = await import("./auth/passwordRouter.js");

// ✅ Middlewares / Security
const { requireAuth } = await import("./middleware/requireAuth.js");
const { verifyPassword } = await import("./security/passwords.js");

// ✅ Outbound
const { default: outboundRouter } = await import("./outbound/outboundRouter.js");
const { default: numbersRouter } = await import("./outbound/numbersRouter.js");
const { default: templatesRouter } = await import("./outbound/templatesRouter.js");
const { default: assetsRouter } = await import("./outbound/assetsRouter.js");
const { default: campaignsRouter } = await import("./outbound/campaignsRouter.js");
const { default: optoutRouter } = await import("./outbound/optoutRouter.js");

// Chatbot engine
const { getChatbotSettingsForAccount, decideRoute } = await import(
  "./chatbot/rulesEngine.js"
);
const { callGenAIBot } = await import("./chatbot/botEngine.js");

// ===============================
// VARIÁVEIS DE AMBIENTE
// ===============================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3010;
const JWT_SECRET = process.env.JWT_SECRET || "gplabs-dev-secret";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

const WABA_ID = process.env.WABA_ID;

logger.info({ envFile }, "🧾 Env carregado");
logger.info(
  {
    WHATSAPP_TOKEN_len: WHATSAPP_TOKEN?.length || "N/A",
    PHONE_NUMBER_ID: PHONE_NUMBER_ID || "N/A",
    VERIFY_TOKEN_defined: !!VERIFY_TOKEN,
    JWT_SECRET_defined: !!process.env.JWT_SECRET,
    OPENAI_API_KEY_defined: !!OPENAI_API_KEY,
    OPENAI_MODEL,
    WABA_ID: WABA_ID || "N/A",
    PORT,
    RESEND_API_KEY_defined: !!process.env.RESEND_API_KEY,
    RESEND_FROM_defined: !!process.env.RESEND_FROM,
    APP_BASE_URL: process.env.APP_BASE_URL || "N/A"
  },
  "✅ Configurações de ambiente carregadas"
);

// ===============================
// HANDLERS GLOBAIS DE ERRO DO NODE
// ===============================
process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "🚨 Unhandled Rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "🚨 Uncaught Exception");
  process.exit(1);
});

// ===============================
// PERSISTÊNCIA EM ARQUIVO (data.json)
// ===============================
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(process.cwd(), "data.json");

let state = loadStateFromDisk();

// garante estruturas básicas
if (!state.users) state.users = [];
if (!state.passwordTokens) state.passwordTokens = []; // ✅ convite/reset
if (!state.conversations) state.conversations = [];
if (!state.messagesByConversation) state.messagesByConversation = {};
if (!state.settings) {
  state.settings = { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
}
if (!state.contacts) state.contacts = [];
if (!Array.isArray(state.outboundCampaigns)) state.outboundCampaigns = [];

// migra contatos a partir das conversas existentes
ensureContactsFromConversations();

// garante admin padrão
ensureDefaultAdminUser();

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

function loadStateFromDisk() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      logger.warn({ DB_FILE }, "📁 data.json não encontrado, criando inicial.");
      const initial = {
        users: [],
        passwordTokens: [],
        contacts: [],
        conversations: [],
        messagesByConversation: {},
        settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
        outboundCampaigns: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.users) parsed.users = [];
    if (!Array.isArray(parsed.passwordTokens)) parsed.passwordTokens = [];
    if (!parsed.contacts) parsed.contacts = [];
    if (!Array.isArray(parsed.outboundCampaigns)) parsed.outboundCampaigns = [];

    logger.info(
      {
        conversationsCount: parsed.conversations?.length || 0,
        contactsCount: parsed.contacts?.length || 0,
        campaignsCount: parsed.outboundCampaigns?.length || 0,
        usersCount: parsed.users?.length || 0,
        tokensCount: parsed.passwordTokens?.length || 0,
        DB_FILE
      },
      "💾 Estado carregado"
    );

    return parsed;
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar data.json");
    return {
      users: [],
      passwordTokens: [],
      contacts: [],
      conversations: [],
      messagesByConversation: {},
      settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
      outboundCampaigns: []
    };
  }
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json");
  }
}

function ensureContactsFromConversations() {
  if (!state.contacts) state.contacts = [];
  const byPhone = new Map();
  let changed = false;

  for (const c of state.contacts) {
    if (c.phone) byPhone.set(c.phone, c);
  }

  const convs = state.conversations || [];
  let nextId =
    state.contacts.length > 0
      ? Math.max(...state.contacts.map((c) => c.id || 0)) + 1
      : 1;

  for (const conv of convs) {
    const phone = conv.phone;
    if (!phone) continue;

    let contact = byPhone.get(phone);
    if (!contact) {
      contact = {
        id: nextId++,
        phone,
        name: conv.contactName || phone,
        createdAt: conv.createdAt || new Date().toISOString()
      };
      state.contacts.push(contact);
      byPhone.set(phone, contact);
      changed = true;
    }

    if (!conv.contactId) {
      conv.contactId = contact.id;
      changed = true;
    }
  }

  if (changed) {
    logger.info({ contactsCount: state.contacts.length }, "🔗 Contatos migrados");
    saveStateToDisk();
  }
}

// Sempre garante o admin@gplabs.com.br com senha dev (legado)
function ensureDefaultAdminUser() {
  const email = "admin@gplabs.com.br";
  const password = "gplabs123";

  if (!state.users) state.users = [];

  const existingIndex = state.users.findIndex(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (existingIndex >= 0) {
    state.users[existingIndex].name = "Administrador";
    state.users[existingIndex].email = email;
    state.users[existingIndex].role = state.users[existingIndex].role || "admin";
    state.users[existingIndex].isActive =
      typeof state.users[existingIndex].isActive === "boolean"
        ? state.users[existingIndex].isActive
        : true;

    state.users[existingIndex].password = password;
    if (state.users[existingIndex].passwordHash === undefined) {
      state.users[existingIndex].passwordHash = null;
    }
    if (!state.users[existingIndex].createdAt)
      state.users[existingIndex].createdAt = new Date().toISOString();
    state.users[existingIndex].updatedAt = new Date().toISOString();
  } else {
    const ids = state.users.map((u) => u.id || 0);
    const nextId = ids.length ? Math.max(...ids) + 1 : 1;

    state.users.push({
      id: nextId,
      name: "Administrador",
      email,
      password,
      passwordHash: null,
      role: "admin",
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveStateToDisk();
  logger.info({ email }, "👤 Usuário admin padrão definido/atualizado");
}

// ===============================
// HELPERS – CONTATOS
// ===============================
function getNextContactId() {
  const ids = (state.contacts || []).map((c) => c.id || 0);
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function findOrCreateContact(phone, name) {
  if (!phone) return null;
  if (!state.contacts) state.contacts = [];

  let contact = state.contacts.find((c) => c.phone === phone);

  if (!contact) {
    contact = {
      id: getNextContactId(),
      phone,
      name: name || phone,
      createdAt: new Date().toISOString()
    };
    state.contacts.push(contact);
    saveStateToDisk();
    logger.info({ contactId: contact.id, phone }, "🆕 Contato criado");
  } else {
    if (name && (!contact.name || contact.name === contact.phone)) {
      contact.name = name;
      saveStateToDisk();
    }
  }

  return contact;
}

// ===============================
// HELPERS – CONVERSAS E MENSAGENS
// ===============================
function getNextConversationId() {
  const ids = state.conversations.map((c) => c.id);
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function getNextMessageId(conversationId) {
  const msgs = state.messagesByConversation[conversationId] || [];
  const ids = msgs.map((m) => m.id);
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function findConversationById(id) {
  return state.conversations.find((c) => c.id === Number(id));
}

function generateSessionId(phone) {
  const clean = (phone || "").replace(/\D/g, "").slice(-8);
  return `S-${clean}-${Date.now()}`;
}

function createNewConversation(phone, contactName, channel) {
  const contact = findOrCreateContact(phone, contactName);

  const id = getNextConversationId();
  const sessionId = generateSessionId(phone);

  const conv = {
    id,
    sessionId,
    contactId: contact ? contact.id : null,
    contactName: contact?.name || contactName || phone,
    phone,
    channel: channel || "whatsapp",
    lastMessage: "",
    status: "open",
    updatedAt: new Date().toISOString(),
    currentMode: "bot",
    botAttempts: 0,
    tags: [],
    notes: ""
  };

  state.conversations.push(conv);
  state.messagesByConversation[id] = state.messagesByConversation[id] || [];
  saveStateToDisk();

  logger.info(
    {
      conversationId: id,
      sessionId,
      phone,
      contactName: conv.contactName,
      channel
    },
    "🆕 Nova conversa criada"
  );

  return conv;
}

function findOrCreateConversationByPhone(phone, contactName, channel) {
  const contact = findOrCreateContact(phone, contactName);
  const convsForPhone = state.conversations.filter((c) => c.phone === phone);

  if (convsForPhone.length === 0) {
    return createNewConversation(phone, contactName, channel);
  }

  const sorted = [...convsForPhone].sort((a, b) => {
    const aTime = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.id - a.id;
  });

  const latest = sorted[0];
  const now = Date.now();
  const lastUpdated = latest.updatedAt ? Date.parse(latest.updatedAt) : now;
  const diff = now - lastUpdated;

  if (contact && latest.contactId !== contact.id) {
    latest.contactId = contact.id;
    latest.contactName = contact.name || latest.contactName;
    saveStateToDisk();
  }

  if (latest.status === "closed") {
    return createNewConversation(phone, contactName, channel);
  }

  if (diff > SESSION_TIMEOUT_MS) {
    latest.status = "closed";
    latest.autoClosed = true;
    latest.closedReason = "timeout_24h";
    latest.updatedAt = new Date().toISOString();
    saveStateToDisk();

    logger.info({ conversationId: latest.id, phone }, "⏱️ Sessão auto-closed (24h)");
    return createNewConversation(phone, contactName, channel);
  }

  if (!latest.currentMode) latest.currentMode = "bot";
  if (typeof latest.botAttempts !== "number") latest.botAttempts = 0;
  if (!latest.channel) latest.channel = channel || "whatsapp";

  if (!state.messagesByConversation[latest.id]) {
    state.messagesByConversation[latest.id] = [];
  }

  return latest;
}

function addMessageToConversation(conversationId, message) {
  if (!state.messagesByConversation[conversationId]) {
    state.messagesByConversation[conversationId] = [];
  }

  const msgs = state.messagesByConversation[conversationId];
  const id = getNextMessageId(conversationId);
  const msgWithId = { id, ...message };

  msgs.push(msgWithId);

  const conv = findConversationById(conversationId);
  if (conv) {
    conv.lastMessage =
      msgWithId.type === "text"
        ? msgWithId.text
        : msgWithId.caption || msgWithId.text || `[${msgWithId.type}]`;
    conv.updatedAt = msgWithId.timestamp || new Date().toISOString();

    if (conv.status === "closed" && msgWithId.direction === "in") {
      conv.status = "open";
    }
  }

  saveStateToDisk();
  return msgWithId;
}

function getConversationHistoryForBot(conversationId, maxMessages = 10) {
  const msgs = state.messagesByConversation[conversationId] || [];
  const last = msgs.slice(-maxMessages);

  return last.map((m) => {
    const role = m.direction === "in" ? "user" : "assistant";
    const content =
      m.type === "text" ? m.text || "" : m.caption || m.text || `[${m.type}]`;
    return { role, content };
  });
}

// ===============================
// 🔎 CAMPANHAS – TRACK STATUS
// ===============================
const META_ERROR_DOCS_BASE =
  "https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes?locale=pt_BR";

function normalizeWaStatus(s) {
  const v = String(s || "").toLowerCase();
  if (v === "sent") return "sent";
  if (v === "delivered") return "delivered";
  if (v === "read") return "read";
  if (v === "failed") return "failed";
  return v || "unknown";
}

function findCampaignResultByWaMessageId(waMessageId) {
  if (!waMessageId) return null;

  const campaigns = Array.isArray(state.outboundCampaigns)
    ? state.outboundCampaigns
    : [];

  for (const c of campaigns) {
    const results = Array.isArray(c?.results) ? c.results : [];
    const r = results.find((x) => x && String(x.waMessageId) === String(waMessageId));
    if (r) return { campaign: c, result: r };
  }

  return null;
}

function applyWebhookStatusToCampaign(statusObj) {
  const waMessageId = statusObj?.id;
  const found = findCampaignResultByWaMessageId(waMessageId);
  if (!found) return false;

  const { campaign, result } = found;
  const newStatus = normalizeWaStatus(statusObj?.status);

  const tsIso = statusObj?.timestamp
    ? new Date(Number(statusObj.timestamp) * 1000).toISOString()
    : new Date().toISOString();

  result.phone = result.phone || statusObj?.recipient_id || result.phone;
  result.status = newStatus;
  result.updatedAt = tsIso;

  if (!Array.isArray(result.statusHistory)) result.statusHistory = [];
  result.statusHistory.push({ at: tsIso, status: newStatus });

  const err0 = Array.isArray(statusObj?.errors) ? statusObj.errors[0] : null;

  if (newStatus !== "failed") {
    result.errorCode = result.errorCode ?? null;
    result.errorMessage = result.errorMessage ?? null;
    result.errorLink = result.errorLink ?? null;

    result.metaErrorCode = result.metaErrorCode ?? null;
    result.metaErrorTitle = result.metaErrorTitle ?? null;
    result.metaErrorMessage = result.metaErrorMessage ?? null;
    result.metaErrorDetails = result.metaErrorDetails ?? null;
    result.metaErrorLink = result.metaErrorLink ?? null;
  }

  if (newStatus === "failed") {
    const code =
      err0?.code != null && String(err0.code).trim()
        ? String(err0.code).trim()
        : null;

    const title = err0?.title || null;
    const message = err0?.message || null;
    const details = err0?.error_data?.details || null;

    result.errorCode = code;
    result.errorMessage = message || title || details || "Falha no envio";
    result.errorLink = code
      ? `/r/meta-error/${encodeURIComponent(code)}`
      : "/r/meta-error";

    result.metaErrorCode = code;
    result.metaErrorTitle = title;
    result.metaErrorMessage = message;
    result.metaErrorDetails = details;
    result.metaErrorLink = result.errorLink;

    result.error = { code, title, message, details };
  }

  campaign.logs = campaign.logs || [];
  campaign.logs.push({
    at: tsIso,
    type: "wa_status",
    message: `Status webhook: ${newStatus} (msgId=${waMessageId})`
  });

  if (!campaign.timeline) campaign.timeline = {};
  if (
    !campaign.timeline.startedAt &&
    (newStatus === "sent" || newStatus === "delivered" || newStatus === "read")
  ) {
    campaign.timeline.startedAt = tsIso;
  }
  campaign.timeline.lastStatusAt = tsIso;

  const results = Array.isArray(campaign.results) ? campaign.results : [];
  const pending = results.some((x) => {
    const st = String(x?.status || "unknown");
    return !st || st === "unknown" || st === "sent";
  });

  if (!pending && !campaign.timeline.finishedAt) {
    campaign.timeline.finishedAt = tsIso;
  }

  if (campaign.timeline.finishedAt && campaign.status === "sending") {
    campaign.status = "done";
  }

  saveStateToDisk();
  return true;
}

// ===============================
// HELPERS – WHATSAPP CLOUD API (SAÍDA)
// ===============================
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, hasPhoneId: !!PHONE_NUMBER_ID },
      "❌ WhatsApp env ausente"
    );
    throw new Error("Configuração WhatsApp ausente");
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();

  if (!res.ok) {
    logger.error({ status: res.status, data }, "❌ Erro ao enviar texto WhatsApp");
    throw new Error("Erro ao enviar mensagem de texto");
  }

  logger.info({ to, waMessageId: data?.messages?.[0]?.id }, "📤 Texto enviado");
  return data;
}

async function sendWhatsAppMedia(to, type, mediaUrl, caption) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, hasPhoneId: !!PHONE_NUMBER_ID },
      "❌ WhatsApp env ausente"
    );
    throw new Error("Configuração WhatsApp ausente");
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const mediaObject = { link: mediaUrl };
  const payload = {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: mediaObject
  };

  if (caption && (type === "image" || type === "video" || type === "document")) {
    mediaObject.caption = caption;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();

  if (!res.ok) {
    logger.error({ status: res.status, data }, "❌ Erro ao enviar mídia WhatsApp");
    throw new Error("Erro ao enviar mídia");
  }

  logger.info({ to, type, waMessageId: data?.messages?.[0]?.id }, "📤 Mídia enviada");
  return data;
}

// ===============================
// HELPERS – WHATSAPP (DOWNLOAD MÍDIA)
// ===============================
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function getExtensionFromMime(mime = "") {
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("aac")) return ".aac";
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("pdf")) return ".pdf";
  if (mime.includes("json")) return ".json";
  if (mime.includes("zip")) return ".zip";
  return ".bin";
}

async function downloadWhatsappMedia(mediaObj, logicalType) {
  if (!mediaObj || !WHATSAPP_TOKEN) return null;

  const mediaId = mediaObj.id;
  const mimeType = mediaObj.mime_type || "application/octet-stream";
  if (!mediaId) return null;

  try {
    let fileUrl = mediaObj.url;

    if (!fileUrl) {
      const metaRes = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
      });
      const meta = await metaRes.json();
      if (!metaRes.ok) {
        logger.error({ status: metaRes.status, meta }, "❌ Erro metadata mídia");
        return null;
      }
      fileUrl = meta.url;
    }

    if (!fileUrl) return null;

    const mediaRes = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    if (!mediaRes.ok) {
      const text = await mediaRes.text();
      logger.error({ status: mediaRes.status, text }, "❌ Erro download mídia");
      return null;
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = getExtensionFromMime(mimeType);
    const filename = `${logicalType || "media"}-${mediaId}-${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;
    logger.info({ mediaId, mimeType, publicUrl }, "💾 Mídia salva");
    return publicUrl;
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado ao baixar mídia");
    return null;
  }
}

// ===============================
// EXPRESS APP
// ===============================
const app = express();
app.set("etag", false);

// HTTP Logs organizados
app.use(
  pinoHttp({
    logger,
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) =>
        req.method === "OPTIONS" ||
        req.url.startsWith("/health") ||
        req.url.startsWith("/uploads/")
    },
    genReqId: (req) =>
      req.headers["x-request-id"]?.toString() ||
      `req_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode >= 400) return "warn";
      return "info";
    },
    serializers: {
      req(req) {
        return { id: req.id, method: req.method, url: req.url };
      },
      res(res) {
        return { statusCode: res.statusCode };
      }
    },
    customSuccessMessage(req, res) {
      const ms = res.responseTime ? `${res.responseTime}ms` : "";
      return `✅ ${req.method} ${req.url} -> ${res.statusCode} ${ms}`.trim();
    },
    customErrorMessage(req, res, err) {
      const ms = res.responseTime ? `${res.responseTime}ms` : "";
      return `❌ ${req.method} ${req.url} -> ${res.statusCode} ${ms} :: ${
        err?.message || "error"
      }`.trim();
    }
  })
);

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// ✅ LINK CURTO (REDIRECT) – META ERROR CODES
// Ex: /r/meta-error/2388073
// ===============================
app.get("/r/meta-error/:code?", (req, res) => {
  const code = (req.params.code || "").trim();
  const target = code
    ? `${META_ERROR_DOCS_BASE}#${encodeURIComponent(code)}`
    : META_ERROR_DOCS_BASE;
  return res.redirect(302, target);
});

// ============================
// ROTAS PRINCIPAIS
// =============================
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

// ===============================
// ✅ SETTINGS (SEM CONFLITO)
// ===============================
// ⚠️ usersRouter já tem paths internos "/users"
app.use("/settings", usersRouter);

// ✅ groupsRouter responde:
// GET /settings/groups
// POST /settings/groups
// PATCH /settings/groups/:id
// PATCH /settings/groups/:id/deactivate
// PATCH /settings/groups/:id/activate
// e dentro dele: /settings/groups/:id/members/*
app.use("/settings/groups", groupsRouter);

// ✅ Auth
app.use("/auth", passwordRouter);

//Web Widget
app.use("/webchat", webchatRouter);
app.use("/settings/channels", channelsRouter);

// ===============================
// ✅ OUTBOUND – ORDEM CORRETA + SEM DUPLICAÇÃO
// ===============================
logger.info("🧩 Montando rotas Outbound (assets/numbers/templates/campaigns/optout/outbound)");

app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);

// Opt-Out (compat dupla)
app.use("/outbound/optout", optoutRouter);
app.use("/outbound", optoutRouter);

// agregador por último
app.use("/outbound", outboundRouter);

// ===============================
// HEALTH / STATUS
// ===============================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "GP Labs – WhatsApp Plataforma API",
    version: "1.0.5",
    wabaId: WABA_ID || null,
    phoneNumberId: PHONE_NUMBER_ID || null
  });
});

app.get("/health", (req, res) => {
  const memory = process.memoryUsage();
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    conversationsCount: state.conversations.length,
    contactsCount: (state.contacts || []).length,
    usersCount: (state.users || []).length,
    memory: { rss: memory.rss, heapUsed: memory.heapUsed },
    wabaId: WABA_ID || null,
    phoneNumberId: PHONE_NUMBER_ID || null
  });
});

// ===============================
// LOGIN – /login
// ===============================
app.post("/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Informe e-mail e senha para entrar." });
  }

  const users = state.users || [];
  const user = users.find(
    (u) => u.email && u.email.toLowerCase() === String(email).toLowerCase()
  );

  if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
  if (user.isActive === false) return res.status(403).json({ error: "Usuário inativo." });

  const ok =
    (user.passwordHash && verifyPassword(String(password), user.passwordHash)) ||
    (!user.passwordHash && String(password) === String(user.password));

  if (!ok) return res.status(401).json({ error: "Senha incorreta." });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role || "agent" },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  logger.info({ email: user.email, role: user.role || "agent" }, "✅ Login realizado");

  return res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role || "agent" }
  });
});

// ===============================
// CONTATOS / CONVERSAS
// ===============================
app.get("/contacts", (req, res) => res.json(state.contacts || []));

app.get("/conversations", (req, res) => {
  const { status } = req.query;
  let conversations = [...state.conversations];

  if (status && status !== "all") {
    conversations = conversations.filter((c) => c.status === status);
  }

  conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  res.json(conversations);
});

app.get("/conversations/:id/messages", (req, res) => {
  const { id } = req.params;
  res.json(state.messagesByConversation[id] || []);
});

app.post("/conversations/:id/messages/human", requireAuth, async (req, res, next) => {
  const { id } = req.params;
  const { text } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });

  if (!text || !text.trim())
    return res.status(400).json({ error: "Texto da mensagem é obrigatório." });

  try {
    const waResponse = await sendWhatsAppText(conversation.phone, text);
    const waMessageId = waResponse?.messages?.[0]?.id || null;

    const me = req.user;

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type: "text",
      text,
      timestamp: new Date().toISOString(),
      waMessageId,
      from: "agent",
      senderId: me.id,
      senderName: me.name,
      senderRole: me.role
    });

    res.status(201).json(message);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao enviar mensagem humana");
    next(err);
  }
});

app.post("/conversations/:id/messages", async (req, res, next) => {
  const { id } = req.params;
  const { text } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
  if (!text || !text.trim())
    return res.status(400).json({ error: "Texto da mensagem é obrigatório." });

  try {
    const waResponse = await sendWhatsAppText(conversation.phone, text);
    const waMessageId = waResponse?.messages?.[0]?.id || null;

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type: "text",
      text,
      timestamp: new Date().toISOString(),
      waMessageId
    });

    res.status(201).json(message);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao enviar mensagem");
    next(err);
  }
});

app.post("/conversations/:id/media", async (req, res, next) => {
  const { id } = req.params;
  const { type, mediaUrl, caption } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });
  if (!type || !mediaUrl)
    return res.status(400).json({ error: "type e mediaUrl são obrigatórios." });

  try {
    const waResponse = await sendWhatsAppMedia(conversation.phone, type, mediaUrl, caption);
    const waMessageId = waResponse?.messages?.[0]?.id || null;

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type,
      text: caption || "",
      mediaUrl,
      timestamp: new Date().toISOString(),
      waMessageId
    });

    res.status(201).json(message);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao enviar mídia");
    next(err);
  }
});

app.patch("/conversations/:id/status", (req, res) => {
  const { id } = req.params;
  const { status, tags } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });

  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "Status inválido. Use 'open' ou 'closed'." });
  }

  conversation.status = status;
  conversation.updatedAt = new Date().toISOString();
  if (Array.isArray(tags)) conversation.tags = tags;

  saveStateToDisk();
  res.json(conversation);
});

app.patch("/conversations/:id/notes", (req, res) => {
  const { id } = req.params;
  const { notes } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) return res.status(404).json({ error: "Conversa não encontrada." });

  conversation.notes = notes || "";
  conversation.updatedAt = new Date().toISOString();
  saveStateToDisk();

  res.json(conversation);
});

// ===============================
// WEBHOOK WHATSAPP (META)
// ===============================
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const received = (token || "").trim();
  const expected = (VERIFY_TOKEN || "").trim();

  logger.info({ mode }, "🌐 GET /webhook/whatsapp");

  if (mode === "subscribe" && received === expected) {
    logger.info("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }

  logger.warn("⚠️ Webhook não autorizado");
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res, next) => {
  try {
    const body = req.body;

    if (body?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];
    const statuses = value?.statuses || [];

    logger.info(
      {
        phone_number_id: value?.metadata?.phone_number_id,
        messagesCount: messages.length,
        statusesCount: statuses.length
      },
      "📩 Webhook recebido"
    );

    if (Array.isArray(statuses) && statuses.length > 0) {
      let updated = 0;
      for (const st of statuses) {
        try {
          const ok = applyWebhookStatusToCampaign(st);
          if (ok) updated++;
        } catch (e) {
          logger.error({ e, stId: st?.id }, "❌ Falha ao aplicar status na campanha");
        }
      }
      if (updated > 0)
        logger.info({ updated }, "📊 Status de campanha atualizados via webhook");
    }

    for (const msg of messages) {
      const waId = msg.from;
      const profileName = value?.contacts?.[0]?.profile?.name;
      const channel = "whatsapp";

      const conv = findOrCreateConversationByPhone(waId, profileName, channel);
      const timestamp = new Date(Number(msg.timestamp) * 1000).toISOString();

      let type = msg.type;
      let text = "";
      let mediaUrl = null;
      let location = null;

      if (type === "text") {
        text = msg.text?.body || "";
      } else if (type === "image") {
        text = msg.image?.caption || "";
        mediaUrl = await downloadWhatsappMedia(msg.image, "image");
      } else if (type === "video") {
        text = msg.video?.caption || "";
        mediaUrl = await downloadWhatsappMedia(msg.video, "video");
      } else if (type === "audio") {
        mediaUrl = await downloadWhatsappMedia(msg.audio, "audio");
      } else if (type === "document") {
        text = msg.document?.caption || msg.document?.filename || "";
        mediaUrl = await downloadWhatsappMedia(msg.document, "document");
      } else if (type === "sticker") {
        mediaUrl = await downloadWhatsappMedia(msg.sticker, "sticker");
      } else if (type === "location") {
        const loc = msg.location;
        if (loc) {
          location = {
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.name || null,
            address: loc.address || null
          };
          text =
            loc.name ||
            loc.address ||
            `Localização: lat=${loc.latitude}, long=${loc.longitude}`;
        }
      }

      const existingMsgs = state.messagesByConversation[conv.id] || [];
      if (existingMsgs.some((m) => m.waMessageId === msg.id)) {
        logger.warn({ waMessageId: msg.id }, "⚠️ Mensagem duplicada, ignorando");
        continue;
      }

      addMessageToConversation(conv.id, {
        direction: "in",
        type,
        text,
        mediaUrl,
        location,
        timestamp,
        waMessageId: msg.id
      });

      const accountId = "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      if (decision.target === "bot" && type === "text") {
        const history = getConversationHistoryForBot(conv.id, 10);
        const botResult = await callGenAIBot({
          accountSettings,
          conversation: conv,
          messageText: text,
          history
        });

        const botReply = botResult.replyText || "";

        try {
          const waResp = await sendWhatsAppText(conv.phone, botReply);
          const waBotMessageId = waResp?.messages?.[0]?.id || null;

          addMessageToConversation(conv.id, {
            direction: "out",
            type: "text",
            text: botReply,
            timestamp: new Date().toISOString(),
            fromBot: true,
            waMessageId: waBotMessageId
          });

          conv.botAttempts = (conv.botAttempts || 0) + 1;
          conv.currentMode = "bot";
          saveStateToDisk();
        } catch (err) {
          logger.error({ err }, "❌ Erro ao enviar texto do bot");
        }
      } else {
        conv.currentMode = "human";
        saveStateToDisk();
      }
    }

    res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao processar webhook");
    next(err);
  }
});

// ===============================
// MIDDLEWARE GLOBAL DE ERRO
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err, path: req.path, method: req.method }, "💥 Erro não tratado");
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  logger.info({ port: PORT, WABA_ID, PHONE_NUMBER_ID }, "🚀 API rodando");
  logger.info(
    "✅ Rotas esperadas: /settings/users, /settings/groups, /settings/groups/:id/members, /auth/*, /outbound/*, /uploads/*"
  );
});
