// backend/src/routes/conversations.js
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
// 🆕 RESOLUÇÃO DE NOME DO CONTATO (PATCH CIRÚRGICO)
// ======================================================
function resolveContactName(payload = {}, rawMsg = {}) {
  return (
    safeStr(payload.title) ||
    safeStr(rawMsg?.profile?.name) ||     // WhatsApp
    safeStr(rawMsg?.sender?.name) ||      // Messenger webhook
    safeStr(rawMsg?.fromName) ||           // Agent / Messenger
    safeStr(rawMsg?.username) ||           // Instagram
    "Contato"
  );
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
    (hasCol(convRow, "currentMode") ? convRow.currentMode : undefined) ??
      m.currentMode ??
      "bot"
  ).toLowerCase();

  const hadHuman = Boolean(m.hadHuman);
  const botAttempts = Number(m.botAttempts || 0);

  const handoffActive = Boolean(
    (hasCol(convRow, "handoffActive") ? convRow.handoffActive : undefined) ??
      m.handoffActive
  );

  const handoffSince =
    (hasCol(convRow, "handoffSince") ? convRow.handoffSince : undefined) ??
    m.handoffSince ??
    null;

  const peerId = safeStr(m.peerId || "");
  const title = safeStr(m.title || "Contato");

  const lastMessagePreview = safeStr(m.lastMessagePreview || "");
  const lastMessageAt = convRow.lastMessageAt
    ? new Date(convRow.lastMessageAt).toISOString()
    : m.lastMessageAt || null;

  let inboxVisible =
    (hasCol(convRow, "inboxVisible") ? convRow.inboxVisible : undefined) ??
    m.inboxVisible;

  if (typeof inboxVisible !== "boolean") {
    inboxVisible = currentMode === "human" || hadHuman === true || handoffActive === true;
  }

  const inboxStatusCol = hasCol(convRow, "inboxStatus") ? convRow.inboxStatus : undefined;
  const inboxStatus = inboxVisible
    ? safeStr(inboxStatusCol ?? m.inboxStatus ?? "waiting_human")
    : "bot_only";

  const queuedAtCol = hasCol(convRow, "queuedAt") ? convRow.queuedAt : undefined;
  const queuedAt = inboxVisible
    ? (queuedAtCol
        ? new Date(queuedAtCol).toISOString()
        : (m.queuedAt || handoffSince || updatedAt))
    : null;

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
    tenantId: convRow.tenantId,
    createdAt,
    updatedAt,
    lastMessageAt,
    lastMessagePreview,
    inboxVisible,
    inboxStatus,
    queuedAt,
    closedAt: convRow.closedAt ? new Date(convRow.closedAt).toISOString() : null,
    closedBy: convRow.closedBy || null,
    closedReason: convRow.closedReason || null
  };
}

// ======================================================
// CORE (PRISMA-FIRST)
// ======================================================
async function upsertContact({ tenantId, channel, peerId, title, phone, waId, visitorId }) {
  return prisma.contact.upsert({
    where: {
      tenantId_channel_externalId: {
        tenantId,
        channel,
        externalId: peerId
      }
    },
    update: {
      ...(title ? { name: title } : {}),
      ...(phone ? { phone } : {}),
      metadata: {
        ...(waId ? { waId } : {}),
        ...(visitorId ? { visitorId } : {})
      }
    },
    create: {
      tenantId,
      channel,
      externalId: peerId,
      name: title || "Contato",
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
  const peerId = safeStr(payload.peerId);

  if (!tenantId || !peerId) {
    return { ok: false, error: "tenantId e peerId obrigatórios" };
  }

  // 🆕 resolve nome aqui
  const resolvedName = resolveContactName(payload);

  const contact = await upsertContact({
    tenantId,
    channel: source,
    peerId,
    title: resolvedName,
    phone: payload.phone || null,
    waId: payload.waId || null,
    visitorId: payload.visitorId || null
  });

  let conv = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId: contact.id,
      channel: source,
      status: "open"
    },
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
        metadata: {
          source,
          channel: source,
          peerId,
          title: resolvedName
        }
      }
    });
  } else {
    // 🆕 atualiza title se ainda estiver genérico
    const meta = getMeta(conv);
    if (meta.title === "Contato" && resolvedName !== "Contato") {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          metadata: setMeta(conv, { title: resolvedName })
        }
      });
    }
  }

  return { ok: true, conversation: normalizeConversationRow(conv) };
}

export async function getOrCreateChannelConversation(dbOrPayload, maybePayload) {
  const payload = maybePayload || dbOrPayload || {};
  const tenantId = safeStr(payload.tenantId);
  const source = safeStr(payload.source || payload.channel || "whatsapp").toLowerCase();
  const peerId = safeStr(payload.peerId);

  if (!tenantId || !peerId) {
    return { ok: false, error: "tenantId e peerId obrigatórios" };
  }

  const resolvedName = resolveContactName(payload, payload.raw || payload);

  const contact = await upsertContact({
    tenantId,
    channel: source,
    peerId,
    title: resolvedName,
    phone: payload.phone || null,
    waId: payload.waId || null,
    visitorId: payload.visitorId || null
  });

  let conv = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId: contact.id,
      channel: source,
      status: "open"
    },
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
        metadata: {
          source,
          channel: source,
          peerId,
          title: resolvedName
        }
      }
    });
  } else {
    const meta = getMeta(conv);
    if (meta.title === "Contato" && resolvedName !== "Contato") {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          metadata: setMeta(conv, { title: resolvedName })
        }
      });
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

  const data = {
    metadata: setMeta(convRow, patch)
  };

  if (hasCol(convRow, "currentMode")) data.currentMode = "human";
  if (hasCol(convRow, "handoffActive")) data.handoffActive = true;
  if (hasCol(convRow, "handoffSince")) data.handoffSince = new Date(patch.handoffSince);
  if (hasCol(convRow, "inboxVisible")) data.inboxVisible = true;
  if (hasCol(convRow, "inboxStatus")) data.inboxStatus = "waiting_human";
  if (hasCol(convRow, "queuedAt")) data.queuedAt = new Date(patch.queuedAt);

  return prisma.conversation.update({
    where: { id: convRow.id },
    data
  });
}

async function touchConversationPrisma({ convRow, msgText }) {
  const atIso = nowIso();
  const preview = safeStr(msgText || "").slice(0, 120);

  const patch = {
    lastMessageAt: atIso,
    lastMessagePreview: preview
  };

  const data = {
    lastMessageAt: new Date(atIso),
    metadata: setMeta(convRow, patch)
  };

  return prisma.conversation.update({
    where: { id: convRow.id },
    data
  });
}

async function bumpBotAttempts({ convRow }) {
  const meta = getMeta(convRow);
  const nextBotAttempts = Number(meta.botAttempts || 0) + 1;

  const data = {
    metadata: setMeta(convRow, {
      botAttempts: nextBotAttempts,
      currentMode: "bot"
    })
  };

  if (hasCol(convRow, "currentMode")) data.currentMode = "bot";

  await prisma.conversation.update({
    where: { id: convRow.id },
    data
  });

  return nextBotAttempts;
}

async function addSystemMessage({ convRow, text, code = "system" }) {
  const createdAtIso = nowIso();

  const msgRow = await prisma.message.create({
    data: {
      id: newId("msg"),
      tenantId: convRow.tenantId,
      conversationId: convRow.id,
      direction: "out",
      type: "system",
      text: safeStr(text),
      status: "sent",
      metadata: {
        from: "system",
        isBot: false,
        code,
        source: getMeta(convRow).source || convRow.channel,
        channel: convRow.channel,
        tenantId: convRow.tenantId
      },
      createdAt: new Date(createdAtIso)
    }
  });

  await touchConversationPrisma({ convRow, msgText: text });
  return msgRow;
}

async function closeConversationPrisma({ convRow, closedBy, closedReason }) {
  const atIso = nowIso();

  const patch = {
    closedAt: atIso,
    closedBy: closedBy || null,
    closedReason: closedReason || "manual_by_agent",
    status: "closed"
  };

  const data = {
    status: "closed",
    metadata: setMeta(convRow, patch)
  };

  if (hasCol(convRow, "closedAt")) data.closedAt = new Date(atIso);
  if (hasCol(convRow, "closedBy")) data.closedBy = patch.closedBy;
  if (hasCol(convRow, "closedReason")) data.closedReason = patch.closedReason;

  // pode esconder da inbox se seu front for "apenas open" (mantém coerência)
  if (hasCol(convRow, "handoffActive")) data.handoffActive = false;
  if (hasCol(convRow, "inboxStatus")) data.inboxStatus = "closed";
  if (hasCol(convRow, "inboxVisible")) data.inboxVisible = false;

  return prisma.conversation.update({
    where: { id: convRow.id },
    data
  });
}

export async function appendMessage(dbOrConversationId, conversationIdOrRaw, maybeRaw) {
  // compat:
  // appendMessage(db, conversationId, rawMsg)  OR  appendMessage(conversationId, rawMsg)
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

  if (convRow.status === "closed") {
    return { ok: false, error: "Conversa encerrada" };
  }

  const convNorm = normalizeConversationRow(convRow);

  const type = safeStr(rawMsg?.type || "text").toLowerCase();
  const text = msgTextFromRaw(rawMsg);

  let from = rawMsg?.from || null;
  let direction = rawMsg?.direction || null;

  if (from === "user" || from === "visitor") from = "client";
  if (from === "human" || from === "attendant") from = "agent";

  const isBot = rawMsg?.isBot === true || from === "bot";

  if (!direction) direction = from === "client" ? "in" : "out";
  if (!from) from = direction === "in" ? "client" : "agent";

  if (isBot) {
    from = "bot";
    direction = "out";
  }

  const waMessageId = rawMsg?.waMessageId ? String(rawMsg.waMessageId) : null;

  // ✅ DEDUPE por waMessageId via JSON path (Message.metadata)
  if (waMessageId) {
    const dup = await prisma.message.findFirst({
      where: {
        tenantId: convRow.tenantId,
        conversationId: convRow.id,
        metadata: {
          path: ["waMessageId"],
          equals: waMessageId
        }
      }
    });

    if (dup) {
      const msgNorm = normalizeMessageRow(convNorm, dup);
      return { ok: true, msg: msgNorm, duplicated: true };
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

  // counters/estado (bot/handoff/inbox)
  if (from === "bot") {
    await bumpBotAttempts({ convRow });
  }

  if (from === "agent" || rawMsg?.handoff === true) {
    await promoteToInboxPrisma({ convRow, reason: "agent_message" });
  }

  await touchConversationPrisma({ convRow, msgText: text });

  const msgNorm = normalizeMessageRow(convNorm, msgRow);
  return { ok: true, msg: msgNorm };
}

// ======================================================
// ROTAS DO PAINEL (PRISMA)
// ======================================================

// GET /conversations?inbox=all
router.get("/", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const rows = await prisma.conversation.findMany({
      where: { tenantId },
      orderBy: { updatedAt: "desc" }
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
      where: { id: req.params.id, tenantId }
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

// POST /conversations/:id/messages  (mensagem do agente)
router.post("/:id/messages", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const convRow = await prisma.conversation.findFirst({
      where: { id: req.params.id, tenantId }
    });

    if (!convRow) return res.status(404).json({ error: "Conversa não encontrada" });
    if (convRow.status === "closed") return res.status(410).json({ error: "Conversa encerrada" });

    const r = await appendMessage(req.params.id, {
      ...req.body,
      from: "agent",
      direction: "out",
      createdAt: nowIso(),
      tenantId
    });

    if (!r.ok) return res.status(400).json({ error: r.error });
    res.status(201).json(r.msg);
  } catch (e) {
    res.status(500).json({ error: "Falha ao enviar mensagem", detail: String(e?.message || e) });
  }
});

// PATCH /conversations/:id/status  (encerrar conversa)
// Body esperado: { status: "closed", reason?: "manual_by_agent" }
router.patch("/:id/status", async (req, res) => {
  try {
    const tenantId = requireTenantOr401(req, res);
    if (!tenantId) return;

    const desired = safeStr(req.body?.status || "").toLowerCase();
    if (desired !== "closed") {
      return res.status(400).json({ error: "Status inválido. Use { status: \"closed\" }" });
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

    // 1) adiciona mensagem system (fica no histórico do chat)
    await addSystemMessage({
      convRow,
      text: "Atendimento encerrado.",
      code: "conversation_closed"
    });

    // 2) fecha conversa
    const updated = await closeConversationPrisma({
      convRow,
      closedBy: userId,
      closedReason: reason
    });

    const norm = normalizeConversationRow(updated);
    return res.json({ ok: true, conversation: norm });
  } catch (e) {
    res.status(500).json({ error: "Falha ao encerrar conversa", detail: String(e?.message || e) });
  }
});

export default router;
