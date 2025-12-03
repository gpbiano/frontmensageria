// index.js (ou server.js)

// ===============================
// IMPORTS
// ===============================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";

dotenv.config();

// ===============================
// VARIÁVEIS DE AMBIENTE
// ===============================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 3001;

console.log("======================================");
console.log("🔐 WHATSAPP_TOKEN length:", WHATSAPP_TOKEN?.length || "N/A");
console.log("📞 PHONE_NUMBER_ID:", PHONE_NUMBER_ID || "N/A");
console.log("✅ VERIFY_TOKEN:", VERIFY_TOKEN ? "definido" : "NÃO definido");
console.log("🚀 Porta da API:", PORT);
console.log("======================================");

// ===============================
// PERSISTÊNCIA EM ARQUIVO (data.json)
// ===============================
const DB_FILE = path.join(process.cwd(), "data.json");

function loadStateFromDisk() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      console.log("💾 data.json ainda não existe, começando vazio");
      return { conversations: [], messagesByConversation: {} };
    }

    const raw = fs.readFileSync(DB_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    console.log(
      "💾 Estado carregado de data.json:",
      `${(parsed.conversations || []).length} conversas`
    );

    return {
      conversations: parsed.conversations || [],
      messagesByConversation: parsed.messagesByConversation || {},
    };
  } catch (err) {
    console.error("❌ Erro ao carregar data.json:", err);
    return { conversations: [], messagesByConversation: {} };
  }
}

function saveStateToDisk(state) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("❌ Erro ao salvar data.json:", err);
  }
}

// ===============================
// APP EXPRESS
// ===============================
const app = express();

app.use(cors());
app.use(express.json());

// ===============================
// DADOS EM MEMÓRIA + PERSISTÊNCIA
// ===============================
const initialState = loadStateFromDisk();

let conversations = initialState.conversations;
let messagesByConversation = initialState.messagesByConversation;

function persist() {
  saveStateToDisk({ conversations, messagesByConversation });
}

// ===============================
// HELPERS
// ===============================
function normalizePhone(phone) {
  return String(phone || "").replace(/[^\d]/g, ""); // deixa só números
}

function findOrCreateConversationByPhone(phone, name) {
  const normalized = normalizePhone(phone);

  let conv = conversations.find(
    (c) => normalizePhone(c.phone) === normalized
  );

  if (!conv) {
    const newId =
      conversations.length > 0
        ? Math.max(...conversations.map((c) => c.id)) + 1
        : 1;

    conv = {
      id: newId,
      contactName: name || normalized,
      phone: normalized,
      lastMessage: "",
      status: "open",
      updatedAt: new Date(),
    };

    conversations.push(conv);
    console.log("🆕 Nova conversa criada:", conv);

    persist(); // salva no arquivo
  }

  return conv;
}

async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error(
      "WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurados no .env"
    );
  }

  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  console.log("➡️ Enviando para WhatsApp:", JSON.stringify(payload, null, 2));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  console.log("⬅️ Resposta do WhatsApp:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(
      `Erro da API do WhatsApp: ${response.status} - ${JSON.stringify(data)}`
    );
  }

  return data;
}

// 🔗 FUNÇÃO PARA OBTER URL TEMPORÁRIA DA MÍDIA
async function getMediaUrl(mediaId) {
  const url = `https://graph.facebook.com/v20.0/${mediaId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
  });

  const json = await response.json();

  return json.url; // link válido por 5 minutos
}

// ===============================
// ROTAS REST
// ===============================

// Raiz – só para ver rapidamente no browser
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "API WhatsApp Plataforma rodando 🚀",
    endpoints: {
      health: "/health",
      conversations: "/conversations",
      webhook: "/webhook/whatsapp",
    },
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API rodando 🚀" });
});

// Lista de conversas
app.get("/conversations", (req, res) => {
  const ordered = [...conversations].sort(
    (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
  );
  console.log("📤 GET /conversations ->", ordered.length, "conversas");
  res.json(ordered);
});

// Histórico de mensagens de uma conversa
app.get("/conversations/:id/messages", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const msgs = messagesByConversation[id] || [];
  console.log(
    `📤 GET /conversations/${id}/messages ->`,
    msgs.length,
    "mensagens"
  );
  res.json(msgs);
});

// Enviar mensagem de TEXTO para uma conversa
app.post("/conversations/:id/messages", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { text } = req.body;

  console.log("📥 POST /conversations/:id/messages", { id, text });

  const conv = conversations.find((c) => c.id === id);

  if (!conv) {
    console.log("❌ Conversa não encontrada para id", id);
    return res.status(404).json({ error: "Conversa não encontrada" });
  }

  try {
    const waResponse = await sendWhatsAppMessage(conv.phone, text);

    const msg = {
      id: (messagesByConversation[id]?.length || 0) + 1,
      direction: "out",
      text,
      timestamp: new Date(),
    };

    if (!messagesByConversation[id]) messagesByConversation[id] = [];
    messagesByConversation[id].push(msg);

    conv.lastMessage = text;
    conv.updatedAt = new Date();

    persist(); // salva alteração no arquivo

    return res.status(201).json({ msg, waResponse });
  } catch (error) {
    console.error("❌ Erro ao enviar para WhatsApp:", error);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// Enviar MÍDIA (imagem, vídeo, pdf, áudio) para uma conversa
app.post("/conversations/:id/media", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { url, type } = req.body; 
  // type pode ser: image, audio, video, document

  console.log("📥 POST /conversations/:id/media", { id, url, type });

  const conv = conversations.find((c) => c.id === id);
  if (!conv) {
    console.log("❌ Conversa não encontrada para id", id);
    return res.status(404).json({ error: "Conversa não encontrada" });
  }

  const payload = {
    messaging_product: "whatsapp",
    to: conv.phone,
    type,
    [type]: { link: url },
  };

  try {
    console.log("➡️ Enviando mídia para WhatsApp:", JSON.stringify(payload, null, 2));

    const waResponse = await fetch(
      `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    ).then((r) => r.json());

    if (!messagesByConversation[id]) messagesByConversation[id] = [];

    messagesByConversation[id].push({
      id: messagesByConversation[id].length + 1,
      direction: "out",
      type,
      mediaUrl: url,
      timestamp: new Date(),
    });

    conv.lastMessage = `[${type}]`;
    conv.updatedAt = new Date();

    persist();

    console.log("📤 Mídia enviada com sucesso:", waResponse);

    return res.json({ ok: true, waResponse });
  } catch (err) {
    console.error("❌ Erro ao enviar mídia:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Atualizar status da conversa (ex: open -> closed)
app.patch("/conversations/:id/status", (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body; // esperado: "open" ou "closed"

  console.log("📥 PATCH /conversations/:id/status", { id, status });

  const conv = conversations.find((c) => c.id === id);

  if (!conv) {
    console.log("❌ Conversa não encontrada para id", id);
    return res.status(404).json({ error: "Conversa não encontrada" });
  }

  conv.status = status || "closed";
  conv.updatedAt = new Date();

  persist(); // salva alteração no data.json

  console.log(
    `✅ Conversa ${id} atualizada para status: ${conv.status}`
  );

  return res.json(conv);
});

// ===============================
// WEBHOOK WHATSAPP
// ===============================

// Verificação do webhook (GET) – usada na Meta
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  console.log("🔎 Verificação de webhook recebida:", {
    mode,
    token,
    challenge,
  });

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  } else {
    console.log("❌ Falha na verificação do webhook");
    return res.sendStatus(403);
  }
});

// Recebimento de mensagens/eventos (POST)
app.post("/webhook/whatsapp", async (req, res) => {
  const body = req.body;

  console.log(
    "📩 WEBHOOK RECEBIDO:",
    JSON.stringify(body, null, 2)
  );

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!Array.isArray(messages)) {
      console.log("⚠️ Nenhuma mensagem recebida");
      return res.sendStatus(200);
    }

    // LOOP DE MENSAGENS RECEBIDAS
    for (const msg of messages) {
      const customerPhone = msg.from;
      const customerName = contacts?.[0]?.profile?.name || customerPhone;

      // GARANTE QUE TEMOS UMA CONVERSA
      const conv = findOrCreateConversationByPhone(
        customerPhone,
        customerName
      );

      if (!messagesByConversation[conv.id]) {
        messagesByConversation[conv.id] = [];
      }

      // ==========================
      // 📌 1) MENSAGEM DE TEXTO
      // ==========================
      if (msg.type === "text") {
        const text = msg.text?.body || "";

        messagesByConversation[conv.id].push({
          id: messagesByConversation[conv.id].length + 1,
          direction: "in",
          text,
          timestamp: new Date(),
        });

        conv.lastMessage = text;
        conv.updatedAt = new Date();

        if (conv.status === "closed") {
          conv.status = "open";
          console.log(`🔄 Reaberta conversa ${conv.id}`);
        }

        persist();
        continue;
      }

      // ==========================
      // 📌 2) IMAGEM RECEBIDA
      // ==========================
      if (msg.type === "image") {
        const mediaId = msg.image.id;
        const mediaUrl = await getMediaUrl(mediaId);

        messagesByConversation[conv.id].push({
          id: messagesByConversation[conv.id].length + 1,
          direction: "in",
          type: "image",
          mediaUrl,
          timestamp: new Date(),
        });

        conv.lastMessage = "[imagem]";
        conv.updatedAt = new Date();
        if (conv.status === "closed") conv.status = "open";

        persist();
        console.log("🖼️ Imagem recebida:", mediaUrl);
        continue;
      }

      // ==========================
      // 📌 3) FIGURINHA RECEBIDA
      // ==========================
      if (msg.type === "sticker") {
        const mediaId = msg.sticker.id;
        const mediaUrl = await getMediaUrl(mediaId);

        messagesByConversation[conv.id].push({
          id: messagesByConversation[conv.id].length + 1,
          direction: "in",
          type: "sticker",
          mediaUrl,
          timestamp: new Date(),
        });

        conv.lastMessage = "[figurinha]";
        conv.updatedAt = new Date();
        if (conv.status === "closed") conv.status = "open";

        persist();
        console.log("🌟 Figurinha recebida:", mediaUrl);
        continue;
      }

      // ==========================
      // ⚠️ TIPOS AINDA NÃO TRATADOS
      // ==========================
      console.log("⚠️ Tipo não tratado:", msg.type);
    }
  } catch (e) {
    console.error("❌ Erro processando webhook:", e);
  }

  // sempre responde 200 pra Meta
  return res.sendStatus(200);
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
});
