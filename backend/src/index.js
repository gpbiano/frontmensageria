import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

console.log("TOKEN LENGTH:", WHATSAPP_TOKEN?.length);
console.log("PHONE ID:", PHONE_NUMBER_ID);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ===============================
// DADOS EM MEMÓRIA (SEM MOCKS)
// ===============================
let conversations = [];
let messagesByConversation = {};

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
  }

  return conv;
}

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  console.log("➡️ Enviando para WA:", payload);

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
  return data;
}

// ===============================
// ROTAS REST
// ===============================

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
  const id = parseInt(req.params.id);
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
  const id = parseInt(req.params.id);
  const { text } = req.body;

  console.log("POST /conversations/:id/messages", { id, text });

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
    console.error("Erro ao enviar para WhatsApp:", error);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// ===============================
// WEBHOOK WHATSAPP
// ===============================

// Verificação do webhook (GET)
app.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

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
    "📩 WEBHOOK RECEBIDO (body.object=",
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

app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`);
});

