// backend/src/routes/channels/whatsappRouter.js
import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import {
  getChatbotSettingsForAccount,
  decideRoute
} from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

// 🧠 Mensagem clássica de handoff
const HANDOFF_MESSAGE =
  "Aguarde um momento, vou te transferir para um atendente. 👩‍💻👨‍💻";

// Palavras-chave simples de pedido humano
const HANDOFF_KEYWORDS = [
  "atendente",
  "humano",
  "pessoa",
  "falar com alguém",
  "falar com atendente",
  "suporte humano"
];

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
  return db;
}

// ======================================================
// WhatsApp ENV
// ======================================================
function getWaConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  return { token, phoneNumberId, apiVersion };
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

// ======================================================
// SEND WhatsApp (texto)
// ======================================================
async function sendWhatsAppText({ to, body }) {
  const { token, phoneNumberId, apiVersion } = getWaConfig();
  if (!token || !phoneNumberId) return { ok: false };

  const fetchFn = await getFetch();

  const payload = {
    messaging_product: "whatsapp",
    to: onlyDigits(to),
    type: "text",
    text: { body }
  };

  const resp = await fetchFn(
    `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const data = await resp.json().catch(() => ({}));
  return resp.ok ? { ok: true, data } : { ok: false, data };
}

// ======================================================
// Verificação Meta
// ======================================================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ======================================================
// Webhook WhatsApp
// ======================================================
router.post("/", async (req, res, next) => {
  try {
    if (req.body?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const value = req.body.entry?.[0]?.changes?.[0]?.value;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];
    if (!messages.length) return res.sendStatus(200);

    const db = ensureDbShape(loadDB());

    for (const msg of messages) {
      const waId = msg.from;
      if (!waId) continue;

      const contact =
        contacts.find((c) => String(c?.wa_id) === String(waId)) || null;

      const text = msg.text?.body || "";
      const lowerText = text.toLowerCase();

      const r = getOrCreateChannelConversation(db, {
        source: "whatsapp",
        peerId: `wa:${waId}`,
        title: contact?.profile?.name || waId,
        waId,
        phone: waId,
        currentMode: "bot"
      });

      if (!r?.ok) continue;
      const conv = r.conversation;

      // =====================
      // INBOUND
      // =====================
      appendMessage(db, conv.id, {
        type: "text",
        from: "client",
        direction: "in",
        text,
        createdAt: nowIso(),
        waMessageId: msg.id,
        channel: "whatsapp",
        source: "whatsapp"
      });

      // =====================
      // 🧑‍💻 HANDOFF
      // =====================
      const wantsHuman = HANDOFF_KEYWORDS.some((k) =>
        lowerText.includes(k)
      );

      if (wantsHuman) {
        await sendWhatsAppText({ to: waId, body: HANDOFF_MESSAGE });

        appendMessage(db, conv.id, {
          type: "system",
          from: "system",
          direction: "out",
          text: HANDOFF_MESSAGE,
          createdAt: nowIso(),
          handoff: true,
          channel: "whatsapp",
          source: "whatsapp"
        });

        // 🚫 para o bot
        conv.currentMode = "human";
        continue;
      }

      // =====================
      // BOT
      // =====================
      const accountSettings = getChatbotSettingsForAccount(conv.accountId || "default");
      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      if (decision?.target === "bot") {
        const botResult = await callGenAIBot({
          accountSettings,
          conversation: conv,
          messageText: text,
          history: []
        });

        const reply = String(botResult?.replyText || "").trim();
        if (!reply) continue;

        const sent = await sendWhatsAppText({ to: waId, body: reply });

        appendMessage(db, conv.id, {
          type: "text",
          from: "bot",
          direction: "out",
          text: reply,
          createdAt: nowIso(),
          isBot: true,
          waMessageId: sent?.data?.messages?.[0]?.id,
          channel: "whatsapp",
          source: "whatsapp"
        });
      }
    }

    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook WhatsApp");
    next(err);
  }
});

export default router;
