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

// ===============================
// CARREGAR ARQUIVO .env CORRETO
// ===============================
const envFile =
  process.env.NODE_ENV === "production"
    ? ".env.production"
    : ".env.development";

dotenv.config({ path: envFile });

console.log("======================================");
console.log("🌱 NODE_ENV:", process.env.NODE_ENV || "development");

// ===============================
// VARIÁVEIS DE AMBIENTE
// ===============================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3010;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:3010";

console.log("🔐 WHATSAPP_TOKEN length:", WHATSAPP_TOKEN?.length || "N/A");
console.log("📞 PHONE_NUMBER_ID:", PHONE_NUMBER_ID || "N/A");
console.log("✅ VERIFY_TOKEN:", VERIFY_TOKEN ? "definido" : "NÃO definido");
console.log("🌐 PUBLIC_BASE_URL:", PUBLIC_BASE_URL);
console.log("🚀 Porta da API:", PORT);
console.log("======================================");

// ===============================
// PERSISTÊNCIA EM ARQUIVO (data.json)
// ===============================
const DB_FILE = path.join(process.cwd(), "data.json");

let state = {
  conversations: [],
  messages: [],
  campaigns: [],
  templates: [],
  mediaLibrary: [],
  campaignResults: [],
};

function loadStateFromDisk() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, "utf-8");
      if (raw.trim().length > 0) {
        state = JSON.parse(raw);
      } else {
        console.log("💾 data.json vazio, iniciando state padrão");
      }
    } else {
      console.log("💾 data.json não encontrado, será criado ao salvar");
    }
  } catch (err) {
    console.error("❌ Erro ao carregar data.json:", err);
  }

  // Garantir coleções novas
  if (!state.conversations) state.conversations = [];
  if (!state.messages) state.messages = [];
  if (!state.campaigns) state.campaigns = [];
  if (!state.templates) state.templates = [];
  if (!state.mediaLibrary) state.mediaLibrary = [];
  if (!state.campaignResults) state.campaignResults = [];

  console.log(
    `💾 Estado carregado de data.json: ${state.conversations.length} conversas`
  );
}

function saveStateToDisk() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Erro ao salvar data.json:", err);
  }
}

// Carrega ao iniciar
loadStateFromDisk();

// ===============================
// APP EXPRESS
// ===============================
const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", "https://bot.gphparticipacoes.com.br"],
  })
);
app.use(express.json());

// ===============================
// FUNÇÕES AUXILIARES
// ===============================

function findOrCreateConversationFromMessage(messageObj, value) {
  const from = messageObj.from;
  const contactName =
    messageObj.profile?.name || `Contato ${from.substring(from.length - 4)}`;

  let conversation = state.conversations.find((c) => c.phone === from);

  if (!conversation) {
    conversation = {
      id:
        state.conversations.length > 0
          ? state.conversations[state.conversations.length - 1].id + 1
          : 1,
      contactName,
      phone: from,
      lastMessage: "",
      status: "open",
      updatedAt: new Date().toISOString(),
    };
    state.conversations.push(conversation);
    console.log("🆕 Nova conversa criada:", conversation);
  }

  return conversation;
}

function addMessageToConversation(conversationId, payload) {
  const newMessage = {
    id:
      state.messages.length > 0
        ? state.messages[state.messages.length - 1].id + 1
        : 1,
    conversationId,
    ...payload,
  };

  state.messages.push(newMessage);

  const conv = state.conversations.find((c) => c.id === conversationId);
  if (conv) {
    if (payload.text) {
      conv.lastMessage = payload.text;
    } else {
      conv.lastMessage = "[mídia]";
    }
    conv.updatedAt = new Date().toISOString();
  }

  saveStateToDisk();
  return newMessage;
}

// ===============================
// ROTAS BÁSICAS / HEALTHCHECK
// ===============================
app.get("/", (req, res) => {
  res.json({ ok: true, service: "GP Labs WhatsApp API", version: "1.0.1" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ===============================
// WHATSAPP WEBHOOK – VERIFICAÇÃO
// ===============================
function whatsappVerifyHandler(req, res) {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }

  console.log("❌ Falha na verificação do webhook");
  return res.sendStatus(403);
}

// ===============================
// WHATSAPP WEBHOOK – RECEBIMENTO
// ===============================
function whatsappReceiveHandler(req, res) {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return res.sendStatus(200);
    }

    messages.forEach((msg) => {
      console.log(`📥 Mensagem de ${msg.from} -> tipo: ${msg.type}`);

      const conv = findOrCreateConversationFromMessage(msg, value);

      const type = msg.type;
      let text = null;
      let mediaId = null;
      let mimeType = null;

      if (type === "text") {
        text = msg.text?.body || null;
      } else if (
        ["image", "audio", "video", "document", "sticker"].includes(type)
      ) {
        const mediaObj = msg[type];
        if (mediaObj) {
          mediaId = mediaObj.id || null;
          mimeType = mediaObj.mime_type || null;
          // legenda (caption) vai em text se existir
          text = mediaObj.caption || null;
        }
      }

      addMessageToConversation(conv.id, {
        from: msg.from,
        to: value.metadata?.display_phone_number || null,
        type,
        text,
        mediaId,
        mimeType,
        direction: "inbound",
        timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
      });
    });

    res.sendStatus(200);
  } catch (err) {
    console.error("❌ Erro ao processar webhook:", err);
    res.sendStatus(500);
  }
}

// Mapear /webhook e /webhook/whatsapp (para Cloudflare)
app.get("/webhook", whatsappVerifyHandler);
app.get("/webhook/whatsapp", whatsappVerifyHandler);
app.post("/webhook", whatsappReceiveHandler);
app.post("/webhook/whatsapp", whatsappReceiveHandler);

// ===============================
// ENVIO DE MENSAGEM AD-HOC (NÃO É O DO CHAT)
// ===============================
app.post("/messages/send", async (req, res) => {
  const { to, text } = req.body;

  if (!to || !text) {
    return res.status(400).json({ error: "to e text são obrigatórios" });
  }

  try {
    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    console.log("📤 Enviando mensagem ad-hoc para WhatsApp:", to);

    const waRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await waRes.json();

    if (!waRes.ok) {
      console.error("❌ Erro ao enviar mensagem para WhatsApp:", data);
      return res.status(waRes.status).json(data);
    }

    // Apenas registra no log; não relaciona com conversa específica
    res.json({ ok: true, data });
  } catch (err) {
    console.error("❌ Erro geral ao enviar mensagem:", err);
    res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// ===============================
// CONVERSAS & HISTÓRICO
// ===============================
app.get("/conversations", (req, res) => {
  const ordered = [...state.conversations].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  res.json(ordered);
});

app.get("/conversations/:id/messages", (req, res) => {
  const id = Number(req.params.id);
  const msgs = state.messages.filter((m) => m.conversationId === id);
  console.log(
    `📤 GET /conversations/${id}/messages -> ${msgs.length} mensagens`
  );
  res.json(msgs);
});

// ✅ ROTA USADA PELO FRONT PARA ENVIAR MENSAGEM NO CHAT
app.post("/conversations/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: "Campo text é obrigatório" });
  }

  const conversation = state.conversations.find((c) => c.id === id);
  if (!conversation) {
    return res.status(404).json({ error: "Conversa não encontrada" });
  }

  const to = conversation.phone;

  try {
    const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    };

    console.log(
      `📤 Enviando mensagem via chat (conversa ${id}) para ${to}:`,
      text
    );

    const waRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await waRes.json();

    if (!waRes.ok) {
      console.error("❌ Erro ao enviar mensagem para WhatsApp:", data);
      return res.status(waRes.status).json(data);
    }

    // Registra mensagem outbound na conversa
    const newMsg = addMessageToConversation(id, {
      from: "me",
      to,
      type: "text",
      text,
      direction: "outbound",
      timestamp: new Date().toISOString(),
    });

    res.status(201).json({ ok: true, message: newMsg, wa: data });
  } catch (err) {
    console.error("❌ Erro geral ao enviar mensagem (chat):", err);
    res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// ===============================
// OUTBOUND – MEDIA LIBRARY
// ===============================
app.get("/media-library", (req, res) => {
  res.json(state.mediaLibrary);
});

app.post("/media-library", (req, res) => {
  const { label, type, url } = req.body;

  if (!label || !type || !url) {
    return res
      .status(400)
      .json({ error: "label, type e url são obrigatórios" });
  }

  const newMedia = {
    id:
      state.mediaLibrary.length > 0
        ? state.mediaLibrary[state.mediaLibrary.length - 1].id + 1
        : 1,
    label,
    type,
    url,
    createdAt: new Date().toISOString(),
  };

  state.mediaLibrary.push(newMedia);
  saveStateToDisk();

  res.status(201).json(newMedia);
});

// ===============================
// OUTBOUND – TEMPLATES
// ===============================
app.get("/templates", (req, res) => {
  res.json(state.templates);
});

app.post("/templates", (req, res) => {
  const { name, body, type, mediaId } = req.body;

  if (!name || !body || !type) {
    return res
      .status(400)
      .json({ error: "name, body e type são obrigatórios" });
  }

  const newTemplate = {
    id:
      state.templates.length > 0
        ? state.templates[state.templates.length - 1].id + 1
        : 1,
    name,
    body,
    type,
    mediaId: mediaId || null,
  };

  state.templates.push(newTemplate);
  saveStateToDisk();

  res.status(201).json(newTemplate);
});

// ===============================
// OUTBOUND – CAMPANHAS
// ===============================
app.get("/campaigns", (req, res) => {
  res.json(state.campaigns);
});

app.post("/campaigns", (req, res) => {
  const { name, description, templateId, scheduledAt } = req.body;

  if (!name || !templateId) {
    return res
      .status(400)
      .json({ error: "name e templateId são obrigatórios" });
  }

  const now = new Date().toISOString();

  const newCampaign = {
    id:
      state.campaigns.length > 0
        ? state.campaigns[state.campaigns.length - 1].id + 1
        : 1,
    name,
    description: description || "",
    templateId,
    status: scheduledAt ? "scheduled" : "draft",
    createdAt: now,
    scheduledAt: scheduledAt || null,
  };

  state.campaigns.push(newCampaign);
  saveStateToDisk();

  res.status(201).json(newCampaign);
});

// Simula envio da campanha
app.post("/campaigns/:id/send", (req, res) => {
  const id = Number(req.params.id);
  const campaign = state.campaigns.find((c) => c.id === id);

  if (!campaign) {
    return res.status(404).json({ error: "Campanha não encontrada" });
  }

  const now = new Date().toISOString();

  campaign.status = "sent";
  campaign.scheduledAt = campaign.scheduledAt || now;

  let report = state.campaignResults.find((r) => r.campaignId === id);

  if (!report) {
    report = {
      campaignId: id,
      sent: 0,
      delivered: 0,
      read: 0,
      failed: 0,
      timeline: {
        startedAt: now,
        finishedAt: now,
      },
      results: [],
    };
    state.campaignResults.push(report);
  } else {
    report.timeline.finishedAt = now;
  }

  saveStateToDisk();

  res.json({ ok: true });
});

// Relatório da campanha
app.get("/campaigns/:id/report", (req, res) => {
  const id = Number(req.params.id);
  const report = state.campaignResults.find((r) => r.campaignId === id);

  if (!report) {
    return res.status(404).json({ error: "Relatório não encontrado" });
  }

  res.json(report);
});

// ===============================
// START SERVER
// ===============================
app.listen(PORT, () => {
  console.log("======================================");
  console.log(`🚀 API rodando na porta ${PORT}`);
  console.log("======================================");
});
