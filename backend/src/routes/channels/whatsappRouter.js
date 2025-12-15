import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import { getChatbotSettingsForAccount, decideRoute } from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

const router = express.Router();

const VERIFY_TOKEN =
  String(process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || "").trim();

const WHATSAPP_TOKEN = String(process.env.WHATSAPP_TOKEN || "").trim();
const PHONE_NUMBER_ID = String(process.env.PHONE_NUMBER_ID || "").trim();

const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

function nowIso() {
  return new Date().toISOString();
}

function cleanPhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function generateSessionId(phone) {
  const clean = cleanPhone(phone).slice(-8);
  return `S-${clean}-${Date.now()}`;
}

function ensureDbShape(db) {
  db.users = ensureArray(db.users);
  db.contacts = ensureArray(db.contacts);
  db.conversations = ensureArray(db.conversations);
  db.messagesByConversation = db.messagesByConversation || {};
  db.settings = db.settings || { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
  db.outboundCampaigns = ensureArray(db.outboundCampaigns);
  return db;
}

function getNextConversationId(db) {
  const ids = (db.conversations || []).map((c) => Number(c?.id) || 0);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function findOrCreateContact(db, phone, name) {
  if (!phone) return null;
  db.contacts = ensureArray(db.contacts);

  let c = db.contacts.find((x) => String(x?.phone) === String(phone));
  if (!c) {
    const ids = db.contacts.map((x) => Number(x?.id) || 0);
    const nextId = (ids.length ? Math.max(...ids) : 0) + 1;

    c = {
      id: nextId,
      phone: String(phone),
      name: name || String(phone),
      createdAt: nowIso()
    };
    db.contacts.push(c);
  } else if (name && (!c.name || c.name === c.phone)) {
    c.name = name;
  }

  return c;
}

/**
 * Regra de sessão:
 * - Se existir conversa OPEN pro telefone e < 24h desde updatedAt, reutiliza
 * - Se estiver CLOSED ou passou 24h, cria nova conversa (id numérico novo)
 */
function findOrCreateConversation(db, phone, contactName) {
  const phoneStr = String(phone || "");
  const contact = findOrCreateContact(db, phoneStr, contactName);

  const convs = ensureArray(db.conversations).filter(
    (c) => String(c?.phone) === phoneStr && String(c?.source || c?.channel) === "whatsapp"
  );

  const sorted = [...convs].sort((a, b) => {
    const aTime = a?.updatedAt ? Date.parse(a.updatedAt) : 0;
    const bTime = b?.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (bTime !== aTime) return bTime - aTime;
    return (Number(b?.id) || 0) - (Number(a?.id) || 0);
  });

  const latest = sorted[0];

  // se não tem nenhuma
  if (!latest) return createConversation(db, phoneStr, contact);

  // se está fechada, cria outra
  if (String(latest.status) === "closed") return createConversation(db, phoneStr, contact);

  // timeout 24h
  const lastUpdated = latest.updatedAt ? Date.parse(latest.updatedAt) : Date.now();
  const diff = Date.now() - lastUpdated;
  if (diff > SESSION_TIMEOUT_MS) {
    latest.status = "closed";
    latest.autoClosed = true;
    latest.closedReason = "timeout_24h";
    latest.updatedAt = nowIso();
    return createConversation(db, phoneStr, contact);
  }

  // mantém coerência de contato
  if (contact && latest.contactId !== contact.id) {
    latest.contactId = contact.id;
    latest.contactName = contact.name || latest.contactName;
  }

  if (!latest.sessionId) latest.sessionId = generateSessionId(phoneStr);
  if (!latest.currentMode) latest.currentMode = "bot";
  if (typeof latest.botAttempts !== "number") latest.botAttempts = 0;
  if (!Array.isArray(latest.tags)) latest.tags = [];
  if (typeof latest.notes !== "string") latest.notes = "";

  return latest;
}

function createConversation(db, phone, contact) {
  const id = getNextConversationId(db);
  const sessionId = generateSessionId(phone);

  const conv = {
    id, // ✅ NUMÉRICO (compat com /conversations/:id/messages)
    sessionId,
    contactId: contact ? contact.id : null,
    contactName: contact?.name || phone,
    phone,
    source: "whatsapp",
    channel: "whatsapp",
    peerId: `wa:${phone}`,
    title: contact?.name || phone,
    status: "open",
    currentMode: "bot",
    botAttempts: 0,
    tags: [],
    notes: "",
    lastMessage: "",
    updatedAt: nowIso(),
    createdAt: nowIso()
  };

  db.conversations.push(conv);
  db.messagesByConversation[String(id)] = db.messagesByConversation[String(id)] || [];

  logger.info({ conversationId: id, sessionId, phone }, "🆕 Nova conversa WhatsApp criada");
  return conv;
}

function appendMessage(db, conversationId, msg) {
  const key = String(conversationId);
  db.messagesByConversation[key] = db.messagesByConversation[key] || [];
  const arr = db.messagesByConversation[key];

  // dedup por waMessageId
  if (msg?.waMessageId && arr.some((m) => String(m?.waMessageId) === String(msg.waMessageId))) {
    return null;
  }

  const ids = arr.map((m) => Number(m?.id) || 0);
  const nextId = (ids.length ? Math.max(...ids) : 0) + 1;

  const full = { id: nextId, ...msg };
  arr.push(full);
  return full;
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

      const profileName = contacts?.[0]?.profile?.name || null;

      const conv = findOrCreateConversation(db, waId, profileName);

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

      const createdIn = appendMessage(db, conv.id, {
        type,
        from: "client",
        direction: "in",
        text,
        createdAt: tsIso,
        waMessageId: msg.id,
        channel: "whatsapp"
      });

      if (createdIn) {
        conv.lastMessage = text || (type !== "text" ? `[${type}]` : "");
        conv.updatedAt = tsIso;
        conv.status = "open";
      }

      // ✅ decide bot x humano
      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      if (decision?.target === "bot" && type === "text") {
        const history = []; // depois a gente monta (últimas N mensagens)
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
            fromBot: true,
            isBot: true,
            waMessageId: waBotId || undefined,
            channel: "whatsapp"
          });

          conv.currentMode = "bot";
          conv.botAttempts = (conv.botAttempts || 0) + 1;
          conv.lastMessage = botReply;
          conv.updatedAt = nowIso();
        }
      } else {
        conv.currentMode = "human";
        conv.updatedAt = nowIso();
      }
    }

    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no whatsappRouter");
    next(err);
  }
});

export default router;
