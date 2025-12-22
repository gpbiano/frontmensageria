// backend/src/routes/channels/whatsappRouter.js
import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import { getChatbotSettingsForAccount, decideRoute } from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

// ✅ CORE OFICIAL
// whatsappRouter.js está em: src/routes/channels/
// conversations.js está em: src/routes/
import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

const HANDOFF_MESSAGE = String(
  process.env.WHATSAPP_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
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
  db.settings = db.settings || { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
  return db;
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

function hasWaConfigured() {
  const { token, phoneNumberId } = getWaConfig();
  return !!(token && phoneNumberId);
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

// ✅ Meta manda outros eventos (statuses, etc). Só queremos messages.
function hasInboundMessages(value) {
  return Array.isArray(value?.messages) && value.messages.length > 0;
}

function getPublicApiBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (envBase) return envBase;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  return `${proto}://${host}`;
}

// ======================================================
// ✅ SEND (Graph API) — envia pro WhatsApp
// ======================================================
async function sendWhatsAppText({ to, body, timeoutMs = 12000 }) {
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!token || !phoneNumberId) {
    logger.error(
      { hasToken: !!token, hasPhoneNumberId: !!phoneNumberId },
      "❌ WHATSAPP_TOKEN / PHONE_NUMBER_ID ausentes. Não dá pra enviar."
    );
    return { ok: false, error: "missing_whatsapp_env" };
  }

  const toDigits = onlyDigits(to);
  if (!toDigits) return { ok: false, error: "missing_to" };

  const cleanBody = String(body || "").trim();
  if (!cleanBody) return { ok: false, error: "missing_body" };

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toDigits,
    type: "text",
    text: { preview_url: false, body: cleanBody }
  };

  const fetchFn = await getFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const raw = await resp.text().catch(() => "");
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!resp.ok) {
      logger.error({ status: resp.status, data, raw }, "❌ WhatsApp send falhou");
      return { ok: false, status: resp.status, data, raw };
    }

    logger.info({ waMessageId: data?.messages?.[0]?.id, to: toDigits }, "✅ WhatsApp send OK");
    return { ok: true, data };
  } catch (err) {
    logger.error({ err }, "❌ WhatsApp send exception");
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
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

    // ✅ Ignora callbacks que não são mensagens (ex: statuses)
    if (!hasInboundMessages(value)) return res.sendStatus(200);

    const messages = value.messages;
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

    if (!hasWaConfigured()) {
      logger.warn(
        "⚠️ WhatsApp ENV não configurado (WHATSAPP_TOKEN / PHONE_NUMBER_ID). Vai salvar, mas não envia."
      );
    }

    let db = ensureDbShape(loadDB());
    const publicBase = getPublicApiBaseUrl(req);

    for (const msg of messages) {
      const waId = msg.from;
      if (!waId) continue;

      // ✅ Anti-loop: se por algum motivo vier mensagem enviada por nós mesmos (raro),
      // não respondemos de novo.
      if (msg.from === value?.metadata?.display_phone_number) {
        continue;
      }

      const contactMatch =
        contacts.find((c) => String(c?.wa_id) === String(waId)) || contacts[0] || null;

      const profileName = contactMatch?.profile?.name || null;

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
      let payload = undefined;

      // =====================
      // TEXT
      // =====================
      if (type === "text") {
        text = msg.text?.body || "";
      }

      // =====================
      // MEDIA
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

        text = media.caption || media.filename || `[${type === "sticker" ? "figurinha" : type}]`;
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

      // ==================================================
      // 🔒 REGRA TRADICIONAL:
      // Se já está em handoff/humano -> NÃO responde bot
      // ==================================================
      const isAlreadyHandoff =
        conv?.handoffActive === true ||
        String(conv?.currentMode || "").toLowerCase() === "human" ||
        conv?.inboxVisible === true;

      if (isAlreadyHandoff) continue;

      // ==================================================
      // BOT DECISION (só decide com texto; outros tipos ficam só no histórico)
      // ==================================================
      if (type !== "text") continue;

      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      const target = String(decision?.target || "bot").toLowerCase();
      const shouldBotReply = target === "bot";

      // ==================================================
      // ✅ HANDOFF (vira humano -> aparece no painel)
      // ==================================================
      if (!shouldBotReply) {
        const sent = await sendWhatsAppText({ to: waId, body: HANDOFF_MESSAGE });

        const waBotId =
          sent?.data?.messages?.[0]?.id ||
          sent?.data?.message_id ||
          sent?.data?.id ||
          null;

        appendMessage(db, conv.id, {
          type: "text",
          from: "bot",
          direction: "out",
          text: HANDOFF_MESSAGE,
          createdAt: nowIso(),
          isBot: true,
          handoff: true,
          waMessageId: waBotId || undefined,
          delivery: sent?.ok
            ? { status: "sent", at: nowIso() }
            : {
                status: "failed",
                error:
                  sent?.raw ||
                  sent?.error ||
                  (sent?.data ? JSON.stringify(sent.data) : "handoff_send_failed"),
                at: nowIso()
              },
          channel: "whatsapp",
          source: "whatsapp"
        });

        // reforça modo local também
        conv.currentMode = "human";
        conv.handoffActive = true;
        conv.handoffSince = conv.handoffSince || nowIso();

        continue;
      }

      // ==================================================
      // ✅ BOT REPLY (texto)
      // ==================================================
      const botResult = await callGenAIBot({
        accountSettings,
        conversation: conv,
        messageText: text,
        history: []
      });

      const reply = String(botResult?.replyText || "").trim();
      if (!reply) continue;

      const sent = await sendWhatsAppText({ to: waId, body: reply });

      const waBotId =
        sent?.data?.messages?.[0]?.id ||
        sent?.data?.message_id ||
        sent?.data?.id ||
        null;

      appendMessage(db, conv.id, {
        type: "text",
        from: "bot",
        direction: "out",
        text: reply,
        createdAt: nowIso(),
        isBot: true,
        waMessageId: waBotId || undefined,
        delivery: sent?.ok
          ? { status: "sent", at: nowIso() }
          : {
              status: "failed",
              error: sent?.raw || sent?.error || (sent?.data ? JSON.stringify(sent.data) : "send_failed"),
              at: nowIso()
            },
        channel: "whatsapp",
        source: "whatsapp"
      });

      conv.currentMode = "bot";
      conv.botAttempts = (conv.botAttempts || 0) + 1;
    }

    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook WhatsApp");
    next(err);
  }
});

export default router;
