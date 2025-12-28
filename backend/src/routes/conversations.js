// backend/src/routes/conversations.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v21.0").trim();
const META_GRAPH_BASE = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

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
  const tid =
    (req.tenant && String(req.tenant.id || "").trim()) ||
    (req.user && String(req.user.tenantId || "").trim()) ||
    "";
  return tid;
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
  const curr = getMeta(obj);
  return { ...curr, ...asJson(patch) };
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
  const s = safeStr(source || "").toLowerCase();
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
// NOME DO CONTATO (4 CANAIS) + FALLBACKS
// ======================================================
function resolveContactName(payload = {}, rawMsg = {}) {
  const waName =
    rawMsg?.contacts?.[0]?.profile?.name ||
    rawMsg?.contact?.profile?.name ||
    rawMsg?.profile?.name ||
    rawMsg?.profile_name ||
    "";

  const msName =
    rawMsg?.sender?.name ||
    rawMsg?.senderName ||
    rawMsg?.fromName ||
    rawMsg?.from?.name ||
    "";

  const igName =
    rawMsg?.username ||
    rawMsg?.from?.username ||
    rawMsg?.sender?.username ||
    rawMsg?.fromName ||
    "";

  const webchatName =
    rawMsg?.visitor?.name ||
    rawMsg?.visitorName ||
    rawMsg?.fromName ||
    "";

  return (
    safeStr(payload.title) ||
    safeStr(payload.name) ||
    safeStr(waName) ||
    safeStr(msName) ||
    safeStr(igName) ||
    safeStr(webchatName) ||
    "Contato"
  );
}

function peerToWhatsAppTo(peerId) {
  const s = safeStr(peerId);
  if (!s) return "";
  if (s.includes(":")) return s.split(":").slice(1).join(":").replace(/\D/g, "");
  return s.replace(/\D/g, "");
}

function peerToPSID(peerId) {
  const s = safeStr(peerId);
  if (!s) return "";
  if (s.includes(":")) return s.split(":").slice(1).join(":").trim();
  return s.trim();
}

function displayNameFallbackByChannel(channel, peerId) {
  const ch = safeStr(channel).toLowerCase();
  if (ch === "whatsapp") return peerToWhatsAppTo(peerId) || "Contato";
  if (ch === "messenger") return peerToPSID(peerId) || "Contato";
  if (ch === "instagram") return peerToPSID(peerId) || "Contato";
  if (ch === "webchat") return safeStr(peerId) || "Contato";
  return safeStr(peerId) || "Contato";
}

// ======================================================
// NORMALIZA PARA O SHAPE LEGADO DO FRONT
// ======================================================
function normalizeConversationRow(convRow) {
  if (!convRow) return null;

  const m = getMeta(convRow);

  const channel = safeStr(convRow.channel || m.channel || "whatsapp").toLowerCase();
  const source = safeStr(m.source || convRow.channel || "whatsapp").toLowerCase();

  const status = convRow.status === "closed" ? "closed" : "open";

  const createdAt = convRow.createdAt ? new Date(convRow.createdAt).toISOString() : nowIso();
  const updatedAt = convRow.updatedAt ? new Date(convRow.updatedAt).toISOString() : createdAt;

  const currentMode = safeStr(
    (hasCol(convRow, "currentMode") ? convRow.currentMode : undefined) ?? m.currentMode ?? "bot"
  ).toLowerCase();

  const hadHuman = Boolean(m.hadHuman);
  const botAttempts = Number(m.botAttempts || 0);

  const handoffActive = Boolean(
    (hasCol(convRow, "handoffActive") ? convRow.handoffActive : undefined) ?? m.handoffActive
  );

  const handoffSinceRaw =
    (hasCol(convRow, "handoffSince") ? convRow.handoffSince : undefined) ??
    m.handoffSince ??
    (handoffActive ? updatedAt : null);

  const handoffSince =
    handoffSinceRaw && handoffSinceRaw instanceof Date
      ? handoffSinceRaw.toISOString()
      : handoffSinceRaw
      ? String(handoffSinceRaw)
      : null;

  const peerId = safeStr(m.peerId || "");

  const title =
    safeStr(m.title) ||
    safeStr(convRow?.contact?.name || "") ||
    displayNameFallbackByChannel(channel, peerId);

  const lastMessagePreview = safeStr(m.lastMessagePreview || "");
  const lastMessageAt = convRow.lastMessageAt
    ? new Date(convRow.lastMessageAt).toISOString()
    : m.lastMessageAt
    ? String(m.lastMessageAt)
    : null;

  let inboxVisible =
    (hasCol(convRow, "inboxVisible") ? convRow.inboxVisible : undefined) ?? m.inboxVisible;

  if (typeof inboxVisible !== "boolean") {
    inboxVisible = currentMode === "human" || hadHuman === true || handoffActive === true;
  }

  const inboxStatusCol = hasCol(convRow, "inboxStatus") ? convRow.inboxStatus : undefined;
  const inboxStatus = inboxVisible
    ? safeStr(inboxStatusCol ?? m.inboxStatus ?? "waiting_human")
    : "bot_only";

  const queuedAtCol = hasCol(convRow, "queuedAt") ? convRow.queuedAt : undefined;
  const queuedAt = inboxVisible
    ? queuedAtCol
      ? new Date(queuedAtCol).toISOString()
      : m.queuedAt || handoffSince || updatedAt
    : null;

  const assignedGroupId = safeStr(
    (hasCol(convRow, "assignedGroupId") ? convRow.assignedGroupId : undefined) ??
      m.assignedGroupId ??
      ""
  );
  const assignedUserId = safeStr(
    (hasCol(convRow, "assignedUserId") ? convRow.assignedUserId : undefined) ??
      m.assignedUserId ??
      ""
  );

  const closedAtMeta = m.closedAt ?? null;
  const closedByMeta = m.closedBy ?? null;
  const closedReasonMeta = m.closedReason ?? null;

  return {
    id: String(convRow.id),
    source,
    channel,
    peerId,
    title,
    status,

    currentMode,
    hadHuman,
    botAttempts,

    handoffActive,
    handoffSince,
    handoffReason: m.handoffReason || null,

    tenantId: convRow.tenantId,

    createdAt,
    updatedAt,
    lastMessageAt,
    lastMessagePreview,

    inboxVisible: Boolean(inboxVisible),
    inboxStatus,
    queuedAt,

    assignedGroupId: assignedGroupId || null,
    assignedUserId: assignedUserId || null,

    closedAt:
      closedAtMeta && closedAtMeta instanceof Date
        ? closedAtMeta.toISOString()
        : closedAtMeta
        ? String(closedAtMeta)
        : null,
    closedBy: closedByMeta || null,
    closedReason: closedReasonMeta || null
  };
}

function normalizeMessageRow(convNorm, msgRow) {
  const mm = getMeta(msgRow);

  const from = safeStr(mm.from || (msgRow.direction === "in" ? "client" : "agent"));
  const isBot = Boolean(mm.isBot || from === "bot");

  return {
    id: String(msgRow.id),
    conversationId: String(msgRow.conversationId),
    channel: mm.channel || convNorm.channel,
    source: mm.source || convNorm.source,
    type: safeStr(msgRow.type || mm.type || "text"),
    from: isBot ? "bot" : from,
    direction: safeStr(msgRow.direction || (from === "client" ? "in" : "out")),
    isBot,
    text: typeof msgRow.text === "string" ? msgRow.text : mm.text || "",
    createdAt: msgRow.createdAt ? new Date(msgRow.createdAt).toISOString() : nowIso(),
    waMessageId: mm.waMessageId || null,
    providerMessageId: mm.providerMessageId || null,
    payload: mm.payload,
    delivery: mm.delivery,
    tenantId: msgRow.tenantId
  };
}

// ======================================================
// ✅ CANAL: LÊ DO LUGAR CERTO (ChannelConfig)
// ======================================================
async function getChannelConn(tenantId, channel) {
  if (!prisma?.channelConfig?.findUnique) return null;

  const row = await prisma.channelConfig
    .findUnique({ where: { tenantId_channel: { tenantId, channel } } })
    .catch(() => null);

  if (!row) return null;
  return { row, config: asJson(row.config) };
}

// ======================================================
// ENVIO PARA META (WHATSAPP/MESSENGER/INSTAGRAM)
// ======================================================
async function sendWhatsAppText({ tenantId, peerId, text }) {
  const conn = await getChannelConn(tenantId, "whatsapp");
  const accessToken = safeStr(conn?.row?.accessToken || "");
  const phoneNumberId = safeStr(conn?.row?.phoneNumberId || "");

  if (!accessToken || !phoneNumberId) {
    return {
      ok: false,
      error: "WhatsApp não conectado (accessToken/phoneNumberId ausentes em ChannelConfig)"
    };
  }

  const to = peerToWhatsAppTo(peerId);
  if (!to) return { ok: false, error: "peerId inválido para WhatsApp (to vazio)" };

  const url = `${META_GRAPH_BASE}/${encodeURIComponent(phoneNumberId)}/messages`;
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: safeStr(text) }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      ok: false,
      error: json?.error?.message || `WhatsApp Graph ${resp.status}`,
      meta: json?.error || json
    };
  }

  const wamid = json?.messages?.[0]?.id || null;
  return { ok: true, providerMessageId: wamid, raw: json };
}

async function sendMessengerText({ tenantId, peerId, text }) {
  const conn = await getChannelConn(tenantId, "messenger");
  const pageAccessToken = safeStr(conn?.row?.accessToken || "");
  if (!pageAccessToken) {
    return { ok: false, error: "Messenger não conectado (accessToken ausente em ChannelConfig)" };
  }

  const psid = peerToPSID(peerId);
  if (!psid) return { ok: false, error: "peerId inválido para Messenger (PSID vazio)" };

  const url = `${META_GRAPH_BASE}/me/messages?access_token=${encodeURIComponent(pageAccessToken)}`;
  const body = {
    messaging_type: "RESPONSE",
    recipient: { id: psid },
    message: { text: safeStr(text) }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return {
      ok: false,
      error: json?.error?.message || `Messenger Graph ${resp.status}`,
      meta: json?.error || json
    };
  }

  return { ok: true, providerMessageId: json?.message_id || null, raw: json };
}

async function sendInstagramText({ tenantId, peerId, text }) {
  const conn = await getChannelConn(tenantId, "instagram");

  const token = safeStr(conn?.row?.accessToken || "");
  const cfg = asJson(conn?.config);

  // ✅ esse é o cara que o IG webhook já usa/cobra
  const instagramBusinessId = safeStr(cfg?.instagramBusinessId || "");
  if (!token) {
    return { ok: false, error: "Instagram não conectado (accessToken ausente em ChannelConfig)" };
  }
  if (!instagramBusinessId) {
    return {
      ok: false,
      error:
        "Instagram não configurado (config.instagramBusinessId ausente). Refaça o connect e garanta que salvou o instagramBusinessAccountId."
    };
  }

  const igUserId = peerToPSID(peerId);
  if (!igUserId) return { ok: false, error: "peerId inválido para Instagram (id vazio)" };

  // ✅ endpoint correto para IG DMs
  const url = `${META_GRAPH_BASE}/${encodeURIComponent(
    instagramBusinessId
  )}/messages?access_token=${encodeURIComponent(token)}`;

  const body = {
    recipient: { id: igUserId },
    message: { text: safeStr(text) }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const raw = await resp.text().catch(() => "");
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  if (!resp.ok) {
    return {
      ok: false,
      error: json?.error?.message || `Instagram Graph ${resp.status}`,
      meta: json?.error || json
    };
  }

  // Meta costuma retornar message_id
  return { ok: true, providerMessageId: json?.message_id || null, raw: json };
}


async function dispatchOutboundToChannel({ convRow, msgText }) {
  const tenantId = convRow.tenantId;
  const meta = getMeta(convRow);
  const peerId = safeStr(meta.peerId || "");
  const channel = safeStr(convRow.channel || meta.channel || "").toLowerCase();

  if (!peerId) return { ok: false, error: "Conversation sem peerId no metadata" };

  if (channel === "whatsapp") return sendWhatsAppText({ tenantId, peerId, text: msgText });
  if (channel === "messenger") return sendMessengerText({ tenantId, peerId, text: msgText });
  if (channel === "instagram") return sendInstagramText({ tenantId, peerId, text: msgText });

  if (channel === "webchat") return { ok: true, providerMessageId: null };

  return { ok: false, error: `Canal não suportado para outbound: ${channel}` };
}

// ======================================================
// CORE (PRISMA-FIRST)
// ======================================================
async function upsertContact({ tenantId, channel, peerId, title, phone, waId, visitorId }) {
  const externalId = safeStr(peerId);
  if (!externalId) throw new Error("peerId obrigatório para criar/achar contato (externalId).");

  const finalName = safeStr(title) || displayNameFallbackByChannel(channel, peerId);

  return prisma.contact.upsert({
    where: { tenantId_channel_externalId: { tenantId, channel, externalId } },
    update: {
      ...(finalName ? { name: finalName } : {}),
      ...(phone ? { phone } : {}),
      metadata: {
        ...(waId ? { waId } : {}),
        ...(visitorId ? { visitorId } : {})
      }
    },
    create: {
      tenantId,
      channel,
      externalId,
      name: finalName,
      phone: phone || null,
      metadata: {
        ...(waId ? { waId } : {}),
        ...(visitorId ? { visitorId } : {})
      }
    }
  });
}

export async function getOrCreateChannelConversation(dbOrPayload, maybePayload) {
  const payload = maybePayload || dbOrPayload || {};
  const tenantId = safeStr(payload.tenantId);

  const source = safeStr(payload.source || payload.channel || "whatsapp").toLowerCase();
  const channel = source;
  const peerId = safeStr(payload.peerId);

  if (!tenantId) return { ok: false, error: "tenantId obrigatório" };
  if (!source || !peerId) return { ok: false, error: "source e peerId obrigatórios" };

  let resolvedName = resolveContactName(payload, payload.raw || payload);
  if (resolvedName === "Contato") resolvedName = displayNameFallbackByChannel(channel, peerId);

  const contact = await upsertContact({
    tenantId,
    channel,
    peerId,
    title: resolvedName,
    phone: payload.phone || null,
    waId: payload.waId || null,
    visitorId: payload.visitorId || null
  });

  let conv = await prisma.conversation.findFirst({
    where: { tenantId, contactId: contact.id, channel, status: "open" },
    orderBy: { updatedAt: "desc" }
  });

  if (!conv) {
    const convId = newId(getConvPrefixBySource(source));

    const baseMeta = {
      source,
      channel,
      peerId,
      title: resolvedName,

      currentMode: safeStr(payload.currentMode || "bot").toLowerCase(),
      hadHuman: false,
      botAttempts: 0,

      handoffActive: false,
      handoffSince: null,
      handoffReason: null,

      lastMessageAt: null,
      lastMessagePreview: "",

      inboxVisible: false,
      inboxStatus: "bot_only",
      queuedAt: null,

      closedAt: null,
      closedBy: null,
      closedReason: null
    };

    conv = await prisma.conversation.create({
      data: {
        id: convId,
        tenantId,
        contactId: contact.id,
        channel,
        status: "open",
        metadata: baseMeta
      }
    });
  } else {
    const meta = getMeta(conv);

    if (!safeStr(meta.title) || safeStr(meta.title) === "Contato") {
      conv = await prisma.conversation.update({
        where: { id: conv.id },
        data: { metadata: setMeta(conv, { title: resolvedName, peerId, channel, source }) }
      });

      await prisma.contact
        .update({ where: { id: contact.id }, data: { name: resolvedName } })
        .catch(() => {});
    }
  }

  return { ok: true, conversation: normalizeConversationRow(conv) };
}

async function promoteToInboxPrisma({ convRow, reason = "handoff" }) {
  const meta = getMeta(convRow);
  const now = nowIso();

  const patch = {
    currentMode: "human",
    hadHuman: true,
    handoffActive: true,
    handoffSince: meta.handoffSince || now,
    handoffReason: reason,

    inboxVisible: true,
    inboxStatus: "waiting_human",
    queuedAt: meta.queuedAt || now
  };

  return prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      currentMode: "human",
      handoffActive: true,
      handoffSince: new Date(patch.handoffSince),
      inboxVisible: true,
      inboxStatus: "waiting_human",
      queuedAt: new Date(patch.queuedAt),
      metadata: setMeta(convRow, patch)
    }
  });
}

async function touchConversationPrisma({ convRow, msgText }) {
  const atIso = nowIso();
  const preview = safeStr(msgText || "").slice(0, 120);

  const patch = { lastMessageAt: atIso, lastMessagePreview: preview };

  return prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      lastMessageAt: new Date(atIso),
      metadata: setMeta(convRow, patch)
    }
  });
}

async function bumpBotAttempts({ convRow }) {
  const meta = getMeta(convRow);
  const nextBotAttempts = Number(meta.botAttempts || 0) + 1;

  await prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      currentMode: "bot",
      metadata: setMeta(convRow, { botAttempts: nextBotAttempts, currentMode: "bot" })
    }
  });

  return nextBotAttempts;
}

export async function appendMessage(dbOrConversationId, conversationIdOrRaw, maybeRaw) {
  const conversationId =
    typeof dbOrConversationId === "string"
      ? dbOrConversationId
      : String(conversationIdOrRaw || "");

  const rawMsg = typeof dbOrConversationId === "string" ? conversationIdOrRaw : maybeRaw;

  if (!conversationId) return { ok: false, error: "conversationId obrigatório" };

  const rawTenantId = rawMsg?.tenantId ? safeStr(rawMsg.tenantId) : "";

  const convRow = rawTenantId
    ? await prisma.conversation.findFirst({ where: { id: conversationId, tenantId: rawTenantId } })
    : await prisma.conversation.findUnique({ where: { id: conversationId } });

  if (!convRow) return { ok: false, error: "Conversa não encontrada" };
  if (convRow.status === "closed") return { ok: false, error: "Conversa encerrada" };

  const convNorm = normalizeConversationRow(convRow);
  const type = safeStr(rawMsg?.type || "text").toLowerCase();
  const text = msgTextFromRaw(rawMsg);

  let from = safeStr(rawMsg?.from || "");
  let direction = safeStr(rawMsg?.direction || "");

  if (from === "user" || from === "visitor") from = "client";
  if (from === "human" || from === "attendant") from = "agent";

  const fromMe = rawMsg?.isFromMe === true || rawMsg?.fromMe === true || rawMsg?.sentByMe === true;

  if (!direction) {
    if (from === "client") direction = "in";
    else if (from === "agent") direction = "out";
    else if (fromMe) direction = "out";
    else direction = "in";
  }

  if (!from) from = direction === "in" ? "client" : "agent";

  const isBot = rawMsg?.isBot === true || from === "bot";
  if (isBot) {
    from = "bot";
    direction = "out";
  }

  const waMessageId = rawMsg?.waMessageId ? String(rawMsg.waMessageId) : null;

  if (waMessageId) {
    const dup = await prisma.message.findFirst({
      where: {
        tenantId: convRow.tenantId,
        conversationId: convRow.id,
        metadata: { path: ["waMessageId"], equals: waMessageId }
      }
    });

    if (dup) {
      const msgNorm = normalizeMessageRow(convNorm, dup);
      return { ok: true, msg: msgNorm, duplicated: true, msgRow: dup, convRow };
    }
  }

  const createdAtIso = rawMsg?.createdAt || rawMsg?.timestamp || nowIso();

  const msgRow = await prisma.message.create({
    data: {
      id: rawMsg?.id || newId("msg"),
      tenantId: convRow.tenantId,
      conversationId: convRow.id,

      direction: safeStr(direction),
      type: type || "text",
      text: text || null,

      mediaUrl: rawMsg?.mediaUrl || null,
      fromName: rawMsg?.fromName || null,
      fromId: rawMsg?.fromId || null,
      status: rawMsg?.status || "sent",

      metadata: {
        from,
        isBot,
        waMessageId,
        payload: rawMsg?.payload,
        delivery: rawMsg?.delivery,
        source: rawMsg?.source || convNorm.source,
        channel: rawMsg?.channel || convNorm.channel,
        tenantId: rawMsg?.tenantId || convRow.tenantId
      },

      createdAt: new Date(createdAtIso)
    }
  });

  // ✅ ENRIQUECE NOME (conversa + contato)
  const metaBefore = getMeta(convRow);
  let nameFromMsg = resolveContactName({}, rawMsg);

  if (nameFromMsg === "Contato") {
    nameFromMsg = displayNameFallbackByChannel(convNorm.channel, metaBefore.peerId || "");
  }

  // atualiza metadata.title
  await prisma.conversation
    .update({
      where: { id: convRow.id },
      data: { metadata: setMeta(convRow, { title: nameFromMsg }) }
    })
    .catch(() => {});

  // atualiza contato
  if (convRow.contactId) {
    await prisma.contact.update({ where: { id: convRow.contactId }, data: { name: nameFromMsg } }).catch(() => {});
  }

  // ✅ contadores / inbox
  if (from === "bot") await bumpBotAttempts({ convRow });

  if (from === "agent" || rawMsg?.handoff === true) {
    const reason = rawMsg?.handoff === true ? "handoff" : "agent_message";
    await promoteToInboxPrisma({ convRow, reason });
  }

  await touchConversationPrisma({ convRow, msgText: text });

  const msgNorm = normalizeMessageRow(convNorm, msgRow);
  return { ok: true, msg: msgNorm, msgRow, convRow };
}

// ======================================================
// ROTAS
// ======================================================

// GET /conversations?inbox=all
router.get("/", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const rows = await prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" },
      include: { contact: true }
    });

    let items = rows.map(normalizeConversationRow).filter(Boolean);

    if (req.query.inbox !== "all") {
      items = items.filter((c) => c.inboxVisible === true);
    }

    items.sort(
      (a, b) =>
        new Date(b.queuedAt || b.updatedAt).getTime() -
        new Date(a.queuedAt || a.updatedAt).getTime()
    );

    res.json(items);
  } catch (e) {
    res.status(500).json({ error: "Falha ao listar conversas", detail: String(e?.message || e) });
  }
});

// GET /conversations/:id/messages
router.get("/:id/messages", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const convRow = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId },
      include: { contact: true }
    });

    if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });

    const convNorm = normalizeConversationRow(convRow);

    const msgs = await prisma.message.findMany({
      where: { tenantId, conversationId: convRow.id },
      orderBy: { createdAt: "asc" }
    });

    res.json(msgs.map((m) => normalizeMessageRow(convNorm, m)));
  } catch (e) {
    res.status(500).json({ error: "Falha ao listar mensagens", detail: String(e?.message || e) });
  }
});

// POST /conversations/:id/messages (mensagem do agente + ✅ tenta enviar pra Meta)
router.post("/:id/messages", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const convRow = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId }
    });

    if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });
    if (convRow.status === "closed") return res.status(410).json({ error: "Conversa encerrada" });

    // 1) grava no banco
    const r = await appendMessage(req.params.id, {
      ...req.body,
      from: "agent",
      direction: "out",
      createdAt: nowIso(),
      tenantId
    });

    if (!r.ok) return res.status(400).json({ error: r.error });

    // 2) tenta enviar pro canal (mas NÃO quebra a request se falhar)
    const text = msgTextFromRaw(req.body);
    if (safeStr(text)) {
      let sendRes = null;

      try {
        sendRes = await dispatchOutboundToChannel({ convRow, msgText: text });
      } catch (err) {
        sendRes = { ok: false, error: "send_exception", meta: String(err?.message || err) };
      }

      const providerMessageId = sendRes?.providerMessageId || null;

      const patchMeta = {
        provider: safeStr(convRow.channel),
        providerMessageId,
        providerSendOk: sendRes?.ok === true,
        providerError: sendRes?.ok ? null : sendRes?.meta || sendRes?.error || "send_failed",
        sentAt: sendRes?.ok ? nowIso() : null
      };

      // ✅ salva resultado do envio no metadata da Message (merge real)
      await prisma.message
        .update({
          where: { id: String(r.msgRow?.id || r.msg?.id) },
          data: {
            status: sendRes?.ok ? "sent" : "failed",
            metadata: { ...(getMeta(r.msgRow) || {}), ...patchMeta }
          }
        })
        .catch(() => {});
    }

    return res.status(201).json(r.msg);
  } catch (e) {
    res.status(500).json({ error: "Falha ao enviar mensagem", detail: String(e?.message || e) });
  }
});

// PATCH /conversations/:id/status (encerrar conversa)
router.patch("/:id/status", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const desired = safeStr(req.body?.status || "").toLowerCase();
    if (desired !== "closed") {
      return res.status(400).json({ error: 'Status inválido. Use { status: "closed" }' });
    }

    const convRow = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId }
    });

    if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });
    if (convRow.status === "closed") {
      const norm = normalizeConversationRow(convRow);
      return res.json({ ok: true, conversation: norm, alreadyClosed: true });
    }

    const userId = safeStr(req.user?.id || req.user?.userId || "", "agent");
    const reason = safeStr(req.body?.reason || "manual_by_agent");

    const atIso = nowIso();
    const patch = {
      status: "closed",
      closedAt: atIso,
      closedBy: userId,
      closedReason: reason,
      handoffActive: false,
      inboxVisible: false,
      inboxStatus: "closed"
    };

    const updated = await prisma.conversation.update({
      where: { id: convRow.id },
      data: {
        status: "closed",
        handoffActive: false,
        inboxVisible: false,
        inboxStatus: "closed",
        metadata: setMeta(convRow, patch)
      }
    });

    const norm = normalizeConversationRow(updated);
    return res.json({ ok: true, conversation: norm });
  } catch (e) {
    res.status(500).json({ error: "Falha ao encerrar conversa", detail: String(e?.message || e) });
  }
});

export default router;
