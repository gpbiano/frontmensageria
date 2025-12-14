// backend/src/services/conversationService.js
import crypto from "crypto";

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * ✅ Normaliza "source" (origem) para evitar conflito:
 * - WhatsApp: source="whatsapp"
 * - Webchat:  source="webchat"
 *
 * ✅ Padroniza IDs:
 * - Conversa webchat: wc_...
 * - Mensagem webchat: wcm_...
 *
 * Obs.: Mantive compatibilidade com o seu modelo atual (channel),
 * mas a chave de verdade passa a ser `source`.
 */
function ensureDbShape(db) {
  if (!db.conversations) db.conversations = [];
  if (!db.messagesByConversation) db.messagesByConversation = {};
  return db;
}

function normalizeSource(conv) {
  // compat: se já tiver source, ok; senão deriva de channel
  if (!conv.source) {
    if (conv.channel === "webchat") conv.source = "webchat";
    else if (conv.channel === "whatsapp") conv.source = "whatsapp";
  }
  return conv;
}

function isWebchatConversation(conv) {
  if (!conv) return false;
  normalizeSource(conv);
  // aceitamos por source, e também por channel como fallback
  return conv.source === "webchat" || conv.channel === "webchat";
}

function newWebchatConversationId() {
  // garante que nunca conflita com WhatsApp nem com conv genérico
  return newId("wc");
}

function newWebchatMessageId() {
  return newId("wcm");
}

// ----------------------------------------------------
// Webchat
// ----------------------------------------------------
export function findConversationByVisitor(db, visitorId) {
  db = ensureDbShape(db);

  return db.conversations.find((c) => {
    normalizeSource(c);

    return (
      isWebchatConversation(c) &&
      c.visitorId === visitorId &&
      c.status === "open"
    );
  });
}

export function createWebchatConversation(db, payload) {
  db = ensureDbShape(db);

  const conv = {
    id: newWebchatConversationId(), // ✅ wc_...
    source: "webchat", // ✅ origem explícita (anti conflito)
    channel: "webchat", // compat com o que já existe no front
    visitorId: payload.visitorId,
    title: payload.title || "Visitante do site",
    status: "open",
    assignedGroupId: null,
    assignedUserId: null,
    notes: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.conversations.push(conv);

  if (!db.messagesByConversation[conv.id]) {
    db.messagesByConversation[conv.id] = [];
  }

  return conv;
}

// ----------------------------------------------------
// Mensagens (genérico, mas com proteção para webchat)
// ----------------------------------------------------
export function addMessage(db, conversationId, message) {
  db = ensureDbShape(db);

  if (!db.messagesByConversation[conversationId]) {
    db.messagesByConversation[conversationId] = [];
  }

  const conv = db.conversations.find((c) => String(c.id) === String(conversationId));
  if (conv) normalizeSource(conv);

  // ✅ se for webchat, reforça canal e id próprio
  const isWebchat = conv ? isWebchatConversation(conv) : message.channel === "webchat";

  const msg = {
    id: isWebchat ? newWebchatMessageId() : newId("msg"),
    conversationId,
    channel: message.channel || (isWebchat ? "webchat" : conv?.channel),
    from: message.from, // visitor | agent | bot
    type: message.type || "text",
    text: message.text,
    createdAt: nowIso()
  };

  db.messagesByConversation[conversationId].push(msg);

  if (conv) conv.updatedAt = msg.createdAt;

  return msg;
}
