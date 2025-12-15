import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import {
  getChatbotSettingsForAccount,
  decideRoute
} from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

// ✅ CORE OFICIAL (conversas + persistência)
import {
  getOrCreateChannelConversation,
  appendMessage
} from "../conversations.js"; // <-- AJUSTE O CAMINHO SE PRECISAR

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

const WHATSAPP_TOKEN = String(process.env.WHATSAPP_TOKEN || "").trim();
const PHONE_NUMBER_ID = String(process.env.PHONE_NUMBER_ID || "").trim();

function nowIso() {
  return new Date().toISOString();
}

function ensureDbShape(db) {
  db.users = ensureArray(db.users);
  db.contacts = ensureArray(db.contacts);
  db.conversations = ensureArray(db.conversations);
  db.messagesByConversation =
    db.messagesByConversation && typeof db.messagesByConversation === "object"
      ? db.messagesByConversation
      : {};
  db.settings = db.settings || { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
  db.outboundCampaigns = ensureArray(db.outboundCampaigns);
  return db;
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

async function sendWhatsAppText(to, body) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    logger.warn(
      { hasToken: !!WHATSAPP_TOKEN, hasPhoneNumberId: !!PHONE_NUMBER_ID },
      "⚠️ WHATSAPP_TOKEN/PHONE_NUMBER_ID ausentes. Pulando envio."
    );
    return { ok: false, skipped: true };
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const fetchFn = await getFetch();
  const resp = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    logger.warn({ status: resp.status, data }, "❌ Erro ao enviar WhatsApp");
    return { ok: false, error: data };
  }
  return { ok: true, data };
}

// ===============================
// GET /webhook/whatsapp (verificação Meta)
// ===============================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];

  logger.info({ mode }, "🌐 GET /webhook/whatsapp");

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Webhook verificado");
    return res.status(200).send(challenge);
  }

  logger.warn({ mode }, "⚠️ Webhook não autorizado");
  return res.sendStatus(403);
});

// ===============================
// POST /webhook/whatsapp (mensagens)
// ===============================
router.post("/", async (req, res, next) => {
  try {
    const body = req.body;

    if (body?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

    logger.info(
      {
        phone_number_id: value?.metadata?.phone_number_id,
        messagesCount: messages.length
      },
      "📩 Webhook WhatsApp recebido"
    );

    if (messages.length === 0) return res.sendStatus(200);

    let db = ensureDbShape(loadDB());

    for (const msg of messages) {
      const waId = msg.from; // telefone do cliente
      if (!waId) continue;

      // casa contato pelo wa_id quando existir
      const contactMatch =
        contacts.find((c) => String(c?.wa_id) === String(waId)) || contacts[0] || null;
      const profileName = contactMatch?.profile?.name || null;

      // ✅ cria/reutiliza conversa via CORE (Modelo A)
      const r = getOrCreateChannelConversation(db, {
        source: "whatsapp",
        peerId: `wa:${waId}`,
        title: profileName || waId,
        waId,
        phone: waId,
        currentMode: "bot"
      });

      if (!r?.ok) {
        logger.warn({ waId, error: r?.error }, "⚠️ Falha ao obter/criar conversa WhatsApp");
        continue;
      }

      const conv = r.conversation;

      const tsIso = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : nowIso();

      const type = msg.type || "text";
      let text = "";

      if (type === "text") text = msg.text?.body || "";
      else if (type === "image") text = msg.image?.caption || "";
      else if (type === "video") text = msg.video?.caption || "";
      else if (type === "document") text = msg.document?.caption || msg.document?.filename || "";
      else if (type === "location") {
        const loc = msg.location;
        text =
          loc?.name ||
          loc?.address ||
          (loc?.latitude && loc?.longitude
            ? `Localização: lat=${loc.latitude}, long=${loc.longitude}`
            : "");
      }

      // ✅ persiste inbound via appendMessage() oficial
      appendMessage(db, conv.id, {
        type,
        from: "client",
        direction: "in",
        text,
        createdAt: tsIso,
        waMessageId: msg.id,
        channel: "whatsapp",
        source: "whatsapp"
      });

      // ✅ decide bot x humano (mantém sua lógica)
      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      if (decision?.target === "bot" && type === "text") {
        const history = []; // depois você pode montar últimas N msgs via db.messagesByConversation[conv.id]
        const botResult = await callGenAIBot({
          accountSettings,
          conversation: conv,
          messageText: text,
          history
        });

        const botReply = String(botResult?.replyText || "").trim();

        if (botReply) {
          const waResp = await sendWhatsAppText(waId, botReply);
          const waBotId = waResp?.data?.messages?.[0]?.id || null;

          appendMessage(db, conv.id, {
            type: "text",
            from: "bot",
            direction: "out",
            text: botReply,
            createdAt: nowIso(),
            isBot: true,
            waMessageId: waBotId || undefined,
            channel: "whatsapp",
            source: "whatsapp"
          });

          conv.currentMode = "bot";
          conv.botAttempts = (conv.botAttempts || 0) + 1;
        }
      } else {
        conv.currentMode = "human";
      }
    }

    // ✅ salva 1 vez no final
    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no whatsappRouter");
    next(err);
  }
});

export default router;
