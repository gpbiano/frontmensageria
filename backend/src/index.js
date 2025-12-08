// backend/src/index.js

// ===============================
// IMPORTS
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

import logger from "./logger.js";
import chatbotRouter from "./chatbot/chatbotRouter.js";
import {
  getChatbotSettingsForAccount,
  decideRoute,
} from "./chatbot/rulesEngine.js";
import { callGenAIBot } from "./chatbot/botEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// ENV – CARREGAR .env.{ENV}
// ===============================
const ENV = process.env.NODE_ENV || "development";
const envFile = `.env.${ENV}`;

logger.info({ envFile }, "🧾 Carregando arquivo de env");

dotenv.config({
  path: path.join(process.cwd(), envFile),
});

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

logger.info(
  {
    WHATSAPP_TOKEN_len: WHATSAPP_TOKEN?.length || "N/A",
    PHONE_NUMBER_ID: PHONE_NUMBER_ID || "N/A",
    VERIFY_TOKEN_defined: !!VERIFY_TOKEN,
    JWT_SECRET_defined: !!JWT_SECRET,
    OPENAI_API_KEY_defined: !!OPENAI_API_KEY,
    OPENAI_MODEL,
    PORT,
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
const DB_FILE = path.join(process.cwd(), "data.json");

let state = loadStateFromDisk();

if (!state.users) state.users = [];
if (!state.conversations) state.conversations = [];
if (!state.messagesByConversation) state.messagesByConversation = {};

ensureDefaultAdminUser();

// -------------------------------
function loadStateFromDisk() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      logger.warn(
        { DB_FILE },
        "📁 data.json não encontrado, criando estrutura inicial."
      );
      const initial = {
        users: [],
        conversations: [],
        messagesByConversation: {},
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    logger.info(
      {
        conversationsCount: parsed.conversations?.length || 0,
        DB_FILE,
      },
      "💾 Estado carregado de data.json"
    );

    return parsed;
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar data.json");
    return {
      users: [],
      conversations: [],
      messagesByConversation: {},
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

// Sempre garante o admin@gplabs.com.br com senha em TEXTO PURO (DEV)
function ensureDefaultAdminUser() {
  const email = "admin@gplabs.com.br";
  const password = "gplabs123";

  if (!state.users) state.users = [];

  const existingIndex = state.users.findIndex(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (existingIndex >= 0) {
    state.users[existingIndex].name = "Administrador";
    state.users[existingIndex].password = password;
  } else {
    const ids = state.users.map((u) => u.id || 0);
    const nextId = ids.length ? Math.max(...ids) + 1 : 1;

    state.users.push({
      id: nextId,
      name: "Administrador",
      email,
      password,
    });
  }

  saveStateToDisk();

  logger.info(
    { email, password },
    "👤 Usuário admin padrão definido/atualizado"
  );
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

function findOrCreateConversationByPhone(phone, contactName) {
  let conv = state.conversations.find((c) => c.phone === phone);

  if (!conv) {
    const id = getNextConversationId();
    conv = {
      id,
      contactName: contactName || phone,
      phone,
      lastMessage: "",
      status: "open",
      updatedAt: new Date().toISOString(),
      currentMode: "bot",
      botAttempts: 0,
    };
    state.conversations.push(conv);

    logger.info(
      { conversationId: id, phone, contactName },
      "🆕 Nova conversa criada"
    );
  } else {
    if (!conv.currentMode) conv.currentMode = "bot";
    if (typeof conv.botAttempts !== "number") conv.botAttempts = 0;
  }

  if (!state.messagesByConversation[conv.id]) {
    state.messagesByConversation[conv.id] = [];
  }

  return conv;
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

/**
 * Monta o histórico para enviar ao bot (IA).
 * Converte mensagens para o formato user/assistant.
 */
function getConversationHistoryForBot(conversationId, maxMessages = 10) {
  const msgs = state.messagesByConversation[conversationId] || [];
  const last = msgs.slice(-maxMessages);

  return last.map((m) => {
    const role = m.direction === "in" ? "user" : "assistant";
    const content =
      m.type === "text" ? m.text || "" : m.caption || m.text || `[${m.type}]`;

    return {
      role,
      content,
    };
  });
}

// ===============================
// HELPERS – WHATSAPP CLOUD API (SAÍDA)
// ===============================
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, hasPhoneId: !!PHONE_NUMBER_ID },
      "❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não definidos."
    );
    throw new Error("Configuração WhatsApp ausente");
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  logger.info({ to, PHONE_NUMBER_ID, url }, "➡️ Enviando mensagem de texto");

  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    logger.error(
      { status: res.status, data },
      "❌ Erro ao enviar mensagem de texto WhatsApp"
    );
    throw new Error("Erro ao enviar mensagem de texto");
  }

  logger.info({ to, data }, "📤 Mensagem de texto enviada");
  return data;
}

async function sendWhatsAppMedia(to, type, mediaUrl, caption) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, hasPhoneId: !!PHONE_NUMBER_ID },
      "❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não definidos."
    );
    throw new Error("Configuração WhatsApp ausente");
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  logger.info(
    { to, type, mediaUrl, PHONE_NUMBER_ID, url },
    "➡️ Enviando mídia WhatsApp"
  );

  const mediaObject = { link: mediaUrl };
  const payload = {
    messaging_product: "whatsapp",
    to,
    type,
    [type]: mediaObject,
  };

  if (caption && (type === "image" || type === "video" || type === "document")) {
    mediaObject.caption = caption;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();

  if (!res.ok) {
    logger.error(
      { status: res.status, data },
      "❌ Erro ao enviar mídia WhatsApp"
    );
    throw new Error("Erro ao enviar mídia");
  }

  logger.info({ to, type, data }, "📤 Mídia enviada para WhatsApp");
  return data;
}

// ===============================
// HELPERS – WHATSAPP CLOUD API (ENTRADA / DOWNLOAD DE MÍDIA)
// ===============================
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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
      const metaRes = await fetch(
        `https://graph.facebook.com/v22.0/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          },
        }
      );

      const meta = await metaRes.json();

      if (!metaRes.ok) {
        logger.error(
          { status: metaRes.status, meta },
          "❌ Erro ao buscar metadata da mídia"
        );
        return null;
      }

      fileUrl = meta.url;
    }

    if (!fileUrl) {
      logger.warn({ mediaId }, "⚠️ Não foi possível obter URL da mídia");
      return null;
    }

    const mediaRes = await fetch(fileUrl, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
    });

    if (!mediaRes.ok) {
      const text = await mediaRes.text();
      logger.error(
        { status: mediaRes.status, text },
        "❌ Erro ao fazer download da mídia"
      );
      return null;
    }

    const arrayBuffer = await mediaRes.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const ext = getExtensionFromMime(mimeType);
    const filename = `${logicalType || "media"}-${mediaId}-${Date.now()}${ext}`;
    const filePath = path.join(UPLOADS_DIR, filename);

    fs.writeFileSync(filePath, buffer);

    const publicUrl = `/uploads/${filename}`;

    logger.info(
      { mediaId, mimeType, publicUrl },
      "💾 Mídia baixada e salva localmente"
    );

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

// Corrige problema de 304 Not Modified
app.set("etag", false);

// Middleware de log HTTP
app.use(
  pinoHttp({
    logger,
    customSuccessMessage(req, res) {
      return `${req.method} ${req.url} -> ${res.statusCode}`;
    },
    customErrorMessage(req, res, err) {
      return `❌ ERRO ${req.method} ${req.url} -> ${res.statusCode}`;
    },
    serializers: {
      req(req) {
        return {
          method: req.method,
          url: req.url,
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
    quietReqLogger: true,
  })
);

app.use(cors());
app.use(express.json());

// Servir uploads locais
app.use("/uploads", express.static(UPLOADS_DIR));

// Rotas de configuração do chatbot
app.use("/api", chatbotRouter);

// ===============================
// HEALTH / STATUS
// ===============================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "GP Labs – WhatsApp Plataforma API",
    version: "1.0.3",
  });
});

app.get("/health", (req, res) => {
  const memory = process.memoryUsage();

  const payload = {
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    conversationsCount: state.conversations.length,
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
    },
  };

  logger.debug(payload, "🔎 Health check");

  res.json(payload);
});

// ===============================
// LOGIN REAL (DEV) – /login
// ===============================
app.post("/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res
      .status(400)
      .json({ error: "Informe e-mail e senha para entrar." });
  }

  const users = state.users || [];
  const user = users.find(
    (u) => u.email && u.email.toLowerCase() === email.toLowerCase()
  );

  if (!user) {
    logger.warn({ email }, "Tentativa de login com usuário inexistente");
    return res.status(401).json({ error: "Usuário não encontrado." });
  }

  const passwordMatch = password === user.password;

  if (!passwordMatch) {
    logger.warn({ email }, "Tentativa de login com senha incorreta");
    return res.status(401).json({ error: "Senha incorreta." });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  logger.info({ email: user.email }, "✅ Login realizado");

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
  });
});

// ===============================
// ROTAS DE CONVERSAS
// ===============================
app.get("/conversations", (req, res) => {
  const { status } = req.query;

  let conversations = [...state.conversations];

  if (status && status !== "all") {
    conversations = conversations.filter((c) => c.status === status);
  }

  conversations.sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );

  res.json(conversations);
});

app.get("/conversations/:id/messages", (req, res) => {
  const { id } = req.params;
  const msgs = state.messagesByConversation[id] || [];
  res.json(msgs);
});

app.post("/conversations/:id/messages", async (req, res, next) => {
  const { id } = req.params;
  const { text } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversa não encontrada." });
  }

  if (!text || !text.trim()) {
    return res.status(400).json({ error: "Texto da mensagem é obrigatório." });
  }

  try {
    const waResponse = await sendWhatsAppText(conversation.phone, text);
    const waMessageId = waResponse?.messages?.[0]?.id || null;

    const timestamp = new Date().toISOString();

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type: "text",
      text,
      timestamp,
      waMessageId,
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
  if (!conversation) {
    return res.status(404).json({ error: "Conversa não encontrada." });
  }

  if (!type || !mediaUrl) {
    return res
      .status(400)
      .json({ error: "type e mediaUrl são obrigatórios." });
  }

  try {
    const waResponse = await sendWhatsAppMedia(
      conversation.phone,
      type,
      mediaUrl,
      caption
    );
    const waMessageId = waResponse?.messages?.[0]?.id || null;

    const timestamp = new Date().toISOString();

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type,
      text: caption || "",
      mediaUrl,
      timestamp,
      waMessageId,
    });

    res.status(201).json(message);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao enviar mídia");
    next(err);
  }
});

app.patch("/conversations/:id/status", (req, res) => {
  const { id } = req.params;
  const { status } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversa não encontrada." });
  }

  if (!["open", "closed"].includes(status)) {
    return res
      .status(400)
      .json({ error: "Status inválido. Use 'open' ou 'closed'." });
  }

  conversation.status = status;
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

  logger.info(
    { mode, received, expected },
    "🌐 GET /webhook/whatsapp"
  );

  if (mode === "subscribe" && received === expected) {
    logger.info("✅ Webhook Verificado com sucesso.");
    return res.status(200).send(challenge);
  }

  logger.warn("⚠️ Webhook não autorizado.");
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res, next) => {
  const body = req.body;
  logger.info({ body }, "📩 Webhook recebido");

  try {
    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages || [];

    for (const msg of messages) {
      const waId = msg.from;
      const profileName = value?.contacts?.[0]?.profile?.name;

      const conv = findOrCreateConversationByPhone(waId, profileName);

      const timestamp = new Date(
        Number(msg.timestamp) * 1000
      ).toISOString();

      let type = msg.type;
      let text = "";
      let mediaUrl = null;
      let location = null;

      // -------------------------------
      // TIPOS DE MENSAGEM
      // -------------------------------
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
            address: loc.address || null,
          };

          text =
            loc.name ||
            loc.address ||
            `Localização: lat=${loc.latitude}, long=${loc.longitude}`;
        }
      }

      // -------------------------------
      // PREVENÇÃO DE DUPLICADOS
      // -------------------------------
      const existingMsgs = state.messagesByConversation[conv.id] || [];
      const alreadyExists = existingMsgs.some(
        (m) => m.waMessageId === msg.id
      );

      if (alreadyExists) {
        logger.warn(
          { waMessageId: msg.id },
          "⚠️ Mensagem já processada, ignorando"
        );
        continue;
      }

      // -------------------------------
      // SALVAR MENSAGEM
      // -------------------------------
      addMessageToConversation(conv.id, {
        direction: "in",
        type,
        text,
        mediaUrl,
        location,
        timestamp,
        waMessageId: msg.id,
      });

      logger.info(
        { waId, conversationId: conv.id, type },
        "💬 Nova mensagem recebida e salva"
      );

      // -------------------------------
      // DECISÃO BOT / HUMANO
      // -------------------------------
      const accountId = "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text,
      });

      logger.info(
        { conversationId: conv.id, decision },
        "🤖 Decisão de roteamento"
      );

      if (decision.target === "bot" && type === "text") {
        const history = getConversationHistoryForBot(conv.id, 10);

        const botResult = await callGenAIBot({
          accountSettings,
          conversation: conv,
          messageText: text,
          history,
        });

        const botReply = botResult.replyText || "";

        try {
          const waResp = await sendWhatsAppText(conv.phone, botReply);
          const waBotMessageId = waResp?.messages?.[0]?.id || null;

          const outTimestamp = new Date().toISOString();

          addMessageToConversation(conv.id, {
            direction: "out",
            type: "text",
            text: botReply,
            timestamp: outTimestamp,
            fromBot: true,
            waMessageId: waBotMessageId,
          });

          conv.botAttempts = (conv.botAttempts || 0) + 1;
          conv.currentMode = "bot";
          saveStateToDisk();

          logger.info(
            { conversationId: conv.id, waBotMessageId },
            "🤖 Resposta do bot enviada"
          );
        } catch (err) {
          logger.error(
            { err },
            "❌ Erro ao enviar mensagem de texto WhatsApp (bot)"
          );
          // não relança para não quebrar o webhook
        }
      } else {
        conv.currentMode = "human";
        saveStateToDisk();
        logger.info(
          { conversationId: conv.id },
          "🧑‍💻 Conversa roteada para humano"
        );
      }
    }

    const statuses = value?.statuses;
    if (statuses && statuses.length > 0) {
      logger.info({ statuses }, "📊 Status de mensagens recebido");
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
  logger.error(
    {
      err,
      path: req.path,
      method: req.method,
      body: req.body,
    },
    "💥 Erro não tratado"
  );

  if (res.headersSent) {
    return next(err);
  }

  res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  logger.info({ port: PORT }, "🚀 API rodando");
});

