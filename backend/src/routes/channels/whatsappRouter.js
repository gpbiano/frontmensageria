// backend/src/routes/channels/whatsappRouter.js
import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import {
  getChatbotSettingsForAccount,
  decideRoute
} from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

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
  db.settings = db.settings || {
    tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"]
  };
  return db;
}

// ======================================================
// ✅ Conversations CORE loader (compatível ESM)
// - evita crash "does not provide an export named ..."
// ======================================================
let __convCore = null;

async function getConversationsCore() {
  if (__convCore) return __convCore;

  const candidates = [
    // caminho mais comum quando o router está em src/routes/channels/*
    () => import("../conversations.js"),
    // fallback (caso você tenha movido conversations para routes raiz)
    () => import("../conversations/index.js"),
    // fallback mais amplo
    () => import("../../routes/conversations.js")
  ];

  let lastError = null;

  for (const load of candidates) {
    try {
      const mod = await load();

      const getOrCreateChannelConversation =
        mod?.getOrCreateChannelConversation || mod?.default?.getOrCreateChannelConversation;

      const appendMessage = mod?.appendMessage || mod?.default?.appendMessage;

      if (
        typeof getOrCreateChannelConversation === "function" &&
        typeof appendMessage === "function"
      ) {
        __convCore = { getOrCreateChannelConversation, appendMessage };
        return __convCore;
      }
    } catch (err) {
      lastError = err;
    }
  }

  logger.error(
    { err: lastError },
    "❌ Conversations core não encontrado ou exports incompatíveis"
  );
  throw new Error("Conversations core não encontrado ou exports incompatíveis");
}

// ======================================================
// WhatsApp ENV (runtime safe)
// ======================================================
function getWaConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  return { token, phoneNumberId, apiVersion };
}

function getPublicApiBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (envBase) return envBase;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "");
  return `${proto}://${host}`;
}

// ======================================================
// GET /webhook/whatsapp (verificação Meta)
// ======================================================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Webhook WhatsApp verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ======================================================
// POST /webhook/whatsapp (mensagens)
// ======================================================
router.post("/", async (req, res, next) => {
  try {
    const body = req.body;
    if (body?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const value = body.entry?.[0]?.changes?.[0]?.value;
    const messages = Array.isArray(value?.messages) ? value.messages : [];
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

    if (!messages.length) return res.sendStatus(200);

    // ✅ carrega core uma única vez por request
    const { getOrCreateChannelConversation, appendMessage } =
      await getConversationsCore();

    let db = ensureDbShape(loadDB());
    const publicBase = getPublicApiBaseUrl(req);

    for (const msg of messages) {
      const waId = msg.from;
      if (!waId) continue;

      const contactMatch =
        contacts.find((c) => String(c?.wa_id) === String(waId)) ||
        contacts[0] ||
        null;

      const profileName = contactMatch?.profile?.name || null;

      // ✅ cria/reutiliza conversa
      const r = getOrCreateChannelConversation(db, {
        source: "whatsapp",
        peerId: `wa:${waId}`,
        title: profileName || waId,
        waId,
        phone: waId,
        currentMode: "bot"
      });

      if (!r?.ok) continue;

      const conv = r.conversation;

      const tsIso = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : nowIso();

      const type = String(msg.type || "text").toLowerCase();
      let text = "";
      let payload;

      // =====================
      // TEXT
      // =====================
      if (type === "text") {
        text = msg.text?.body || "";
      }

      // =====================
      // MEDIA (image/video/audio/document/sticker)
      // =====================
      if (["image", "video", "audio", "document", "sticker"].includes(type)) {
        const media = msg[type] || {};
        const mediaId = media.id || null;

        payload = mediaId
          ? {
              mediaId,
              mimeType: media.mime_type,
              sha256: media.sha256,
              filename: media.filename,
              animated: media.animated,
              voice: media.voice,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;

        text =
          media.caption ||
          media.filename ||
          `[${type === "sticker" ? "figurinha" : type}]`;
      }

      // =====================
      // LOCATION
      // =====================
      if (type === "location") {
        const loc = msg.location || {};
        payload = {
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.name,
            address: loc.address
          }
        };
        text =
          loc.name ||
          loc.address ||
          (loc.latitude != null && loc.longitude != null
            ? `Localização: ${loc.latitude}, ${loc.longitude}`
            : "[localização]");
      }

      // =====================
      // PERSISTE INBOUND
      // =====================
      appendMessage(db, conv.id, {
        type,
        from: "client",
        direction: "in",
        text,
        payload,
        createdAt: tsIso,
        waMessageId: msg.id,
        channel: "whatsapp",
        source: "whatsapp"
      });

      // =====================
      // BOT DECISION
      // =====================
      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      if (decision?.target === "bot" && type === "text") {
        const botResult = await callGenAIBot({
          accountSettings,
          conversation: conv,
          messageText: text,
          history: []
        });

        const reply = String(botResult?.replyText || "").trim();
        if (reply) {
          appendMessage(db, conv.id, {
            type: "text",
            from: "bot",
            direction: "out",
            text: reply,
            createdAt: nowIso(),
            isBot: true,
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

    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook WhatsApp");
    next(err);
  }
});

export default router;
