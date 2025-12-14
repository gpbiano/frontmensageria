// backend/src/services/conversationService.js
import crypto from "crypto";

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

export function findConversationByVisitor(db, visitorId) {
  return db.conversations.find(
    (c) =>
      c.channel === "webchat" &&
      c.visitorId === visitorId &&
      c.status === "open"
  );
}

export function createWebchatConversation(db, payload) {
  const conv = {
    id: newId("conv"),
    channel: "webchat",
    visitorId: payload.visitorId,
    title: "Visitante do site",
    status: "open",
    assignedGroupId: null,
    assignedUserId: null,
    notes: "",
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.conversations.push(conv);
  db.messagesByConversation[conv.id] = [];

  return conv;
}

export function addMessage(db, conversationId, message) {
  if (!db.messagesByConversation[conversationId]) {
    db.messagesByConversation[conversationId] = [];
  }

  const msg = {
    id: newId("msg"),
    conversationId,
    channel: message.channel,
    from: message.from, // visitor | agent | bot
    type: "text",
    text: message.text,
    createdAt: nowIso()
  };

  db.messagesByConversation[conversationId].push(msg);

  const conv = db.conversations.find((c) => c.id === conversationId);
  if (conv) conv.updatedAt = msg.createdAt;

  return msg;
}
