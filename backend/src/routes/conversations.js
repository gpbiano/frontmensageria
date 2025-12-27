import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";

const router = express.Router();

// ======================================================
// HELPERS
// ======================================================
function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "id") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function pickTenantId(req) {
  return (
    (req.tenant && String(req.tenant.id || "").trim()) ||
    (req.user && String(req.user.tenantId || "").trim()) ||
    ""
  );
}

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function asJson(obj) {
  return obj && typeof obj === "object" ? obj : {};
}

function getMeta(obj) {
  return asJson(obj?.metadata);
}

function setMeta(obj, patch) {
  return { ...getMeta(obj), ...asJson(patch) };
}

function hasCol(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function msgTextFromRaw(raw) {
  if (!raw) return "";
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.text?.body === "string") return raw.text.body;
  if (typeof raw.content === "string") return raw.content;
  if (typeof raw.caption === "string") return raw.caption;
  return "";
}

function getConvPrefixBySource(source) {
  const s = safeStr(source).toLowerCase();
  if (s === "whatsapp") return "wa";
  if (s === "webchat") return "wc";
  if (s === "instagram") return "ig";
  if (s === "messenger") return "ms";
  return "conv";
}

function requireTenantOr401(req, res) {
  const tenantId = pickTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: "tenantId não resolvido" });
    return null;
  }
  return tenantId;
}

// ======================================================
// 🆕 RESOLUÇÃO DE NOME DO CONTATO
// ======================================================
function resolveContactName(payload = {}, rawMsg = {}) {
  return (
    safeStr(payload.title) ||
    safeStr(rawMsg?.profile?.name) ||
    safeStr(rawMsg?.sender?.name) ||
    safeStr(rawMsg?.fromName) ||
    safeStr(rawMsg?.username) ||
    "Contato"
  );
}

// ======================================================
// NORMALIZA CONVERSA (FRONT)
// ======================================================
function normalizeConversationRow(convRow) {
  const m = getMeta(convRow);

  const currentMode = safeStr(
    (hasCol(convRow, "currentMode") ? convRow.currentMode : undefined) ??
      m.currentMode ??
      "bot"
  ).toLowerCase();

  const handoffActive =
    (hasCol(convRow, "handoffActive") ? convRow.handoffActive : undefined) ??
    m.handoffActive ??
    false;

  let inboxVisible =
    (hasCol(convRow, "inboxVisible") ? convRow.inboxVisible : undefined) ??
    m.inboxVisible;

  if (typeof inboxVisible !== "boolean") {
    inboxVisible = currentMode === "human" || handoffActive === true;
  }

  return {
    id: String(convRow.id),
    tenantId: convRow.tenantId,
    source: safeStr(m.source || convRow.channel),
    channel: safeStr(convRow.channel),
    peerId: safeStr(m.peerId),
    title: safeStr(m.title || "Contato"),
    status: convRow.status === "closed" ? "closed" : "open",

    currentMode,
    hadHuman: Boolean(m.hadHuman),
    botAttempts: Number(m.botAttempts || 0),

    handoffActive,
    handoffSince: m.handoffSince || null,

    inboxVisible,
    inboxStatus: inboxVisible
      ? safeStr(convRow.inboxStatus || m.inboxStatus || "waiting_human")
      : "bot_only",

    queuedAt:
      inboxVisible &&
      (convRow.queuedAt
        ? new Date(convRow.queuedAt).toISOString()
        : m.queuedAt || convRow.updatedAt),

    lastMessageAt: convRow.lastMessageAt
      ? new Date(convRow.lastMessageAt).toISOString()
      : m.lastMessageAt || null,

    lastMessagePreview: safeStr(m.lastMessagePreview || ""),

    createdAt: new Date(convRow.createdAt).toISOString(),
    updatedAt: new Date(convRow.updatedAt).toISOString(),

    closedAt: convRow.closedAt ? new Date(convRow.closedAt).toISOString() : null,
    closedBy: convRow.closedBy || null,
    closedReason: convRow.closedReason || null
  };
}

// ======================================================
// CONTACT + CONVERSATION (ÚNICA FUNÇÃO)
// ======================================================
async function upsertContact({ tenantId, channel, peerId, title }) {
  return prisma.contact.upsert({
    where: {
      tenantId_channel_externalId: {
        tenantId,
        channel,
        externalId: peerId
      }
    },
    update: { name: title },
    create: {
      tenantId,
      channel,
      externalId: peerId,
      name: title
    }
  });
}

export async function getOrCreateChannelConversation(dbOrPayload, maybePayload) {
  const payload = maybePayload || dbOrPayload || {};

  const tenantId = safeStr(payload.tenantId);
  const source = safeStr(payload.source || payload.channel || "whatsapp").toLowerCase();
  const peerId = safeStr(payload.peerId);

  if (!tenantId || !peerId) {
    return { ok: false, error: "tenantId e peerId obrigatórios" };
  }

  const title = resolveContactName(payload, payload.raw || payload);

  const contact = await upsertContact({
    tenantId,
    channel: source,
    peerId,
    title
  });

  let conv = await prisma.conversation.findFirst({
    where: { tenantId, contactId: contact.id, channel: source, status: "open" },
    orderBy: { updatedAt: "desc" }
  });

  if (!conv) {
    conv = await prisma.conversation.create({
      data: {
        id: newId(getConvPrefixBySource(source)),
        tenantId,
        contactId: contact.id,
        channel: source,
        status: "open",
        inboxVisible: false,
        inboxStatus: "bot_only",
        metadata: { source, channel: source, peerId, title }
      }
    });
  }

  return { ok: true, conversation: normalizeConversationRow(conv) };
}

// ======================================================
// ROTAS
// ======================================================
router.get("/", async (req, res) => {
  const tenantId = requireTenantOr401(req, res);
  if (!tenantId) return;

  const rows = await prisma.conversation.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" }
  });

  res.json(rows.map(normalizeConversationRow));
});

export default router;
