import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

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
    // console.log("💾 Estado salvo em data.json");
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
    
        conversations.push(conv);
    console.log("🆕 Nova conversa criada:", conv);

    persist(); // <--- salva no arquivo

  }

  return conv;
}

async function sendWhatsAppMessage(to, text) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurados no .env");
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

// Enviar mensagem para uma conversa
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

    return res.status(201).json({ msg, waResponse });
  } catch (error) {
    console.error("❌ Erro ao enviar para WhatsApp:", error);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
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
app.post("/webhook/whatsapp", (req, res) => {
  const body = req.body;
  console.log(
    "📩 WEBHOOK RECEBIDO (body.object =",
    body.object,
    "):",
    JSON.stringify(body, null, 2)
  );

  try {
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const contacts = value?.contacts;

    if (!Array.isArray(messages)) {
      console.log("⚠️ Nenhuma mensagem encontrada em value.messages");
    } else {
      messages.forEach((msg) => {
        if (msg.type === "text") {
          const customerPhone = msg.from; // ex: 5564...
          const text = msg.text?.body || "";
          const customerName =
            contacts?.[0]?.profile?.name || customerPhone;

          console.log("📥 Mensagem de", customerPhone, "->", text);

          const conv = findOrCreateConversationByPhone(
            customerPhone,
            customerName
          );

          if (!messagesByConversation[conv.id]) {
            messagesByConversation[conv.id] = [];
          }

          messagesByConversation[conv.id].push({
            id: messagesByConversation[conv.id].length + 1,
            direction: "in",
            text,
            timestamp: new Date(),
          });
          

          conv.lastMessage = text;
          conv.updatedAt = new Date();

          console.log(
            `💬 Nova mensagem de ${customerPhone} adicionada à conversa ${conv.id}`
          );
        } else {
          console.log("⚠️ Tipo de mensagem não tratado:", msg.type);
        }
      });
    }
  } catch (e) {
    console.error("❌ Erro processando webhook:", e);
  }

  // sempre responde 200 pra Meta
  res.sendStatus(200);
});

// ===============================
// INICIAR SERVIDOR
// ===============================
app.listen(PORT, () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
});