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

import chatbotRouter from "./chatbot/chatbotRouter.js";
import {
  getChatbotSettingsForAccount,
  decideRoute
} from "./chatbot/rulesEngine.js";
import { callGenAIBot } from "./chatbot/botEngine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===============================
// ENV – CARREGAR .env.{ENV}
// ===============================
const ENV = process.env.NODE_ENV || "development";
const envFile = `.env.${ENV}`;

console.log("🧾 Carregando arquivo de env:", envFile);

dotenv.config({
  path: path.join(process.cwd(), envFile)
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

console.log("======================================");
console.log("🔐 WHATSAPP_TOKEN length:", WHATSAPP_TOKEN?.length || "N/A");
console.log("📞 PHONE_NUMBER_ID:", PHONE_NUMBER_ID || "N/A");
console.log("✅ VERIFY_TOKEN:", VERIFY_TOKEN ? "definido" : "NÃO definido");
console.log("🔑 JWT_SECRET:", JWT_SECRET ? "definido" : "NÃO definido");
console.log("🧠 OPENAI_API_KEY:", OPENAI_API_KEY ? "definida" : "NÃO definida");
console.log("🤖 OPENAI_MODEL:", OPENAI_MODEL);
console.log("🚀 Porta da API:", PORT);
console.log("======================================");

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
      console.log("📁 data.json não encontrado, criando estrutura inicial.");
      const initial = {
        users: [],
        conversations: [],
        messagesByConversation: {}
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    console.log(
      `💾 Estado carregado de data.json: ${parsed.conversations?.length || 0} conversas`
    );
    return parsed;
  } catch (err) {
    console.error("❌ Erro ao carregar data.json:", err);
    return {
      users: [],
      conversations: [],
      messagesByConversation: {}
    };
  }
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Erro ao salvar data.json:", err);
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
      password
    });
  }

  saveStateToDisk();

  console.log("👤 Usuário admin padrão definido/atualizado:");
  console.log("   Email:", email);
  console.log("   Senha:", password);
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
      botAttempts: 0
    };
    state.conversations.push(conv);
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
        : msgWithId.caption || `[${msgWithId.type}]`;
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
      m.type === "text"
        ? m.text || ""
        : m.caption || `[${m.type}]`;

    return {
      role,
      content
    };
  });
}

// ===============================
// HELPERS – WHATSAPP CLOUD API
// ===============================
async function sendWhatsAppText(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não definidos.");
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
    console.error("❌ Erro ao enviar mensagem de texto WhatsApp:", data);
    throw new Error("Erro ao enviar mensagem de texto");
  }

  console.log("📤 Mensagem de texto enviada para", to, "->", data);
  return data;
}

async function sendWhatsAppMedia(to, type, mediaUrl, caption) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    console.error("❌ WHATSAPP_TOKEN ou PHONE_NUMBER_ID não definidos.");
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
    console.error("❌ Erro ao enviar mídia WhatsApp:", data);
    throw new Error("Erro ao enviar mídia");
  }

  console.log("📤 Mídia enviada para", to, "->", data);
  return data;
}

// ===============================
// EXPRESS APP
// ===============================
const app = express();

app.use(cors());
app.use(express.json());

// Rotas de configuração do chatbot
app.use("/api", chatbotRouter);

// ===============================
// HEALTH / STATUS
// ===============================
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "GP Labs – WhatsApp Plataforma API",
    version: "1.0.1"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    conversationsCount: state.conversations.length
  });
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
    return res.status(401).json({ error: "Usuário não encontrado." });
  }

  const passwordMatch = password === user.password;

  if (!passwordMatch) {
    return res.status(401).json({ error: "Senha incorreta." });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "8h" }
  );

  console.log("✅ Login realizado para:", user.email);

  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email
    }
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

app.post("/conversations/:id/messages", async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};

  const conversation = findConversationById(id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversa não encontrada." });
  }

  if (!text) {
    return res.status(400).json({ error: "Texto da mensagem é obrigatório." });
  }

  try {
    await sendWhatsAppText(conversation.phone, text);

    const timestamp = new Date().toISOString();

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type: "text",
      text,
      timestamp
    });

    res.status(201).json(message);
  } catch (err) {
    console.error("❌ Erro ao enviar mensagem:", err);
    res.status(500).json({ error: "Erro ao enviar mensagem." });
  }
});

app.post("/conversations/:id/media", async (req, res) => {
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
    await sendWhatsAppMedia(conversation.phone, type, mediaUrl, caption);

    const timestamp = new Date().toISOString();

    const message = addMessageToConversation(conversation.id, {
      direction: "out",
      type,
      text: caption || "",
      mediaUrl,
      timestamp
    });

    res.status(201).json(message);
  } catch (err) {
    console.error("❌ Erro ao enviar mídia:", err);
    res.status(500).json({ error: "Erro ao enviar mídia." });
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

  console.log("🌐 GET /webhook/whatsapp", { mode, token, challenge });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook Verificado com sucesso.");
    return res.status(200).send(challenge);
  }

  console.warn("⚠️ Webhook não autorizado.");
  return res.sendStatus(403);
});

app.post("/webhook/whatsapp", async (req, res) => {
  const body = req.body;
  console.log("📩 Webhook recebido:", JSON.stringify(body, null, 2));

  try {
    if (body.object === "whatsapp_business_account") {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      const messages = value?.messages;
      if (messages && messages.length > 0) {
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

          if (type === "text") {
            text = msg.text?.body || "";
          } else if (type === "image") {
            mediaUrl = msg.image?.link || null;
            text = msg.image?.caption || "";
          } else if (type === "video") {
            mediaUrl = msg.video?.link || null;
            text = msg.video?.caption || "";
          } else if (type === "document") {
            mediaUrl = msg.document?.link || null;
            text = msg.document?.caption || msg.document?.filename || "";
          } else if (type === "audio") {
            mediaUrl = msg.audio?.link || null;
          } else if (type === "sticker") {
            mediaUrl = msg.sticker?.link || null;
          }

          // =======================================================
          // PREVENÇÃO DE MENSAGENS DUPLICADAS
          // =======================================================
          const existingMsgs = state.messagesByConversation[conv.id] || [];
          const alreadyExists = existingMsgs.some(
            (m) => m.waMessageId === msg.id
          );

          if (alreadyExists) {
            console.log("⚠️ Mensagem já processada, ignorando:", msg.id);
            continue;
          }

          // 1) Salvar mensagem recebida
          addMessageToConversation(conv.id, {
            direction: "in",
            type,
            text,
            mediaUrl,
            timestamp,
            waMessageId: msg.id
          });

          console.log(
            `💬 Nova mensagem de ${waId} adicionada à conversa ${conv.id}`
          );

          // 2) Decidir se vai para BOT ou HUMANO
          const accountId = "default"; // por enquanto uma conta única
          const accountSettings = getChatbotSettingsForAccount(accountId);

          const decision = decideRoute({
            accountSettings,
            conversation: conv,
            messageText: text
          });

          console.log(
            `🤖 Roteamento da conversa ${conv.id}:`,
            decision.target,
            "-",
            decision.reason
          );

          if (decision.target === "bot" && type === "text") {
            // 3) Montar histórico para o bot
            const history = getConversationHistoryForBot(conv.id, 10);

            // 4) Chamar IA
            const botResult = await callGenAIBot({
              accountSettings,
              conversation: conv,
              messageText: text,
              history
            });

            const botReply = botResult.replyText || "";

            try {
              // 5) Enviar resposta via WhatsApp
              await sendWhatsAppText(conv.phone, botReply);

              const outTimestamp = new Date().toISOString();

              // 6) Salvar mensagem de resposta do BOT
              addMessageToConversation(conv.id, {
                direction: "out",
                type: "text",
                text: botReply,
                timestamp: outTimestamp,
                fromBot: true
              });

              // 7) Atualizar tentativas do bot e modo
              conv.botAttempts = (conv.botAttempts || 0) + 1;
              conv.currentMode = "bot";
              saveStateToDisk();
            } catch (err) {
              console.error(
                "❌ Erro ao enviar mensagem de texto WhatsApp:",
                err
              );
              throw new Error("Erro ao enviar mensagem de texto");
            }
          } else {
            // Vai para humano: marcar modo humano
            conv.currentMode = "human";
            saveStateToDisk();
          }
        }
      }

      const statuses = value?.statuses;
      if (statuses && statuses.length > 0) {
        console.log("📊 Status de mensagens:", JSON.stringify(statuses, null, 2));
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err);
    res.sendStatus(500);
  }
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
});
