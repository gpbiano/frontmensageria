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
  // prioridade: resolveTenant -> req.tenant / token -> req.user.tenantId
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

function msgTextFromRaw(raw) {
  if (!raw) return "";
  if (typeof raw.text === "string") return raw.text;
  if (typeof raw.text?.body === "string") return raw.text.body;
  if (typeof raw.content === "string") return raw.content;
  if (typeof raw.caption === "string") return raw.caption;
  return "";
}

// ======================================================
// NORMALIZA PARA O SHAPE LEGADO DO FRONT
// (mantém compatibilidade com ChatPanel / Inbox)
// ======================================================
function normalizeConversationRow(convRow) {
  if (!convRow) return null;

  const m = getMeta(convRow);

  const channel = safeStr(convRow.channel || m.channel || "whatsapp").toLowerCase();
  const source = safeStr(m.source || convRow.channel || "whatsapp").toLowerCase();

  const status = convRow.status === "closed" ? "closed" : "open";

  const createdAt = convRow.createdAt ? new Date(convRow.createdAt).toISOString() : nowIso();
  const updatedAt = convRow.updatedAt ? new Date(convRow.updatedAt).toISOString() : createdAt;

  const currentMode = safeStr(m.currentMode || "bot");
  const hadHuman = Boolean(m.hadHuman);
  const botAttempts = Number(m.botAttempts || 0);

  const handoffActive = Boolean(m.handoffActive);
  const handoffSince = m.handoffSince || (handoffActive ? updatedAt : null);

  const peerId = safeStr(m.peerId || "");
  const title = safeStr(m.title || "Contato");

  const lastMessagePreview = safeStr(m.lastMessagePreview || "");
  const lastMessageAt = convRow.lastMessageAt
    ? new Date(convRow.lastMessageAt).toISOString()
    : m.lastMessageAt || null;

  // regra do painel (legado)
  let inboxVisible = m.inboxVisible;
  if (typeof inboxVisible !== "boolean") {
    inboxVisible =
      currentMode === "human" || hadHuman === true || handoffActive === true;
  }

  const inboxStatus = inboxVisible ? safeStr(m.inboxStatus || "waiting_human") : "bot_only";

  const queuedAt = inboxVisible
    ? m.queuedAt || handoffSince || updatedAt
    : null;

  return {
    // legado
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

    inboxVisible,
    inboxStatus,
    queuedAt
  };
}

function normalizeMessageRow(convNorm, msgRow) {
  const mm = getMeta(msgRow);

  const from = safeStr(mm.from || (msgRow.direction === "in" ? "client" : "agent"));
  const isBot = Boolean(mm.isBot || from === "bot");
  const waMessageId = mm.waMessageId || null;

  return {
    id: String(msgRow.id),
    conversationId: String(msgRow.conversationId),
    channel: mm.channel || convNorm.channel,
    source: mm.source || convNorm.source,
    type: safeStr(msgRow.type || mm.type || "text"),
    from: isBot ? "bot" : from,
    direction: safeStr(msgRow.direction || (from === "client" ? "in" : "out")),
    isBot,
    text: typeof msgRow.text === "string" ? msgRow.text : (mm.text || ""),
    createdAt: msgRow.createdAt ? new Date(msgRow.createdAt).toISOString() : nowIso(),
    waMessageId,
    payload: mm.payload,
    delivery: mm.delivery,
    tenantId: msgRow.tenantId
  };
}

// ======================================================
// CORE (PRISMA-FIRST, SEM data.json)
// Mantém a assinatura antiga para não quebrar imports existentes:
// getOrCreateChannelConversation(db, payload) e appendMessage(db, conversationId, rawMsg)
// ======================================================

async function upsertContact({ tenantId, channel, peerId, title, phone, waId, visitorId }) {
  // usamos externalId = peerId para dedupe por canal
  // (se vc preferir, pode usar externalId diferente, mas mantenha estável)
  const externalId = safeStr(peerId);

  // ✅ OBS: externalId é opcional no schema, mas aqui a gente precisa dele.
  // Se vier vazio, cria contato "solto" (não recomendado). Por segurança, bloqueia:
  if (!externalId) {
    throw new Error("peerId obrigatório para criar/achar contato (externalId).");
  }

  // nome composto automático: Contact_tenantId_channel_externalId_key
  // no prisma client, vira: tenantId_channel_externalId
  return prisma.contact.upsert({
    where: {
      tenantId_channel_externalId: {
        tenantId,
        channel,
        externalId
      }
    },
    update: {
      name: title || undefined,
      phone: phone || undefined,
      metadata: {
        ...(waId ? { waId } : {}),
        ...(visitorId ? { visitorId } : {})
      }
    },
    create: {
      tenantId,
      channel,
      externalId,
      name: title || null,
      phone: phone || null,
      metadata: {
        ...(waId ? { waId } : {}),
        ...(visitorId ? { visitorId } : {})
      }
    }
  });
}

export async function getOrCreateChannelConversation(dbOrPayload, maybePayload) {
  // compat: se chamarem (payload) ao invés de (db,payload)
  const payload = maybePayload || dbOrPayload || {};
  const tenantId = safeStr(payload.tenantId);

  const source = safeStr(payload.source || payload.channel || "whatsapp").toLowerCase();
  const channel = source; // padrão do legado
  const peerId = safeStr(payload.peerId);

  if (!tenantId) return { ok: false, error: "tenantId obrigatório" };
  if (!source || !peerId) return { ok: false, error: "source e peerId obrigatórios" };

  const contact = await upsertContact({
    tenantId,
    channel,
    peerId,
    title: payload.title || "Contato",
    phone: payload.phone || null,
    waId: payload.waId || null,
    visitorId: payload.visitorId || null
  });

  // regra: nunca reabrir closed -> só reutiliza se OPEN
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId,
      contactId: contact.id,
      channel,
      status: "open"
    },
    orderBy: { updatedAt: "desc" }
  });

  let conv = existing;

  if (!conv) {
    const convId = newId(source === "whatsapp" ? "wa" : "wc");

    conv = await prisma.conversation.create({
      data: {
        id: convId,
        tenantId,
        contactId: contact.id,
        channel,
        status: "open",
        lastMessageAt: null,
        metadata: {
          // ✅ estado legado salvo no metadata
          source,
          channel,
          peerId,
          title: payload.title || "Contato",

          currentMode: payload.currentMode || "bot",
          hadHuman: false,
          botAttempts: 0,

          handoffActive: false,
          handoffSince: null,
          handoffReason: null,

          lastMessageAt: null,
          lastMessagePreview: "",

          inboxVisible: false,
          inboxStatus: "bot_only",
          queuedAt: null
        }
      }
    });
  }

  const convNorm = normalizeConversationRow(conv);
  return { ok: true, conversation: convNorm };
}

async function promoteToInboxPrisma({ convRow, reason = "handoff" }) {
  const meta = getMeta(convRow);

  const patch = {
    currentMode: "human",
    hadHuman: true,
    handoffActive: true,
    handoffSince: meta.handoffSince || nowIso(),
    handoffReason: reason,

    inboxVisible: true,
    inboxStatus: "waiting_human",
    queuedAt: meta.queuedAt || nowIso()
  };

  return prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      metadata: setMeta(convRow, patch)
    }
  });
}

async function touchConversationPrisma({ convRow, msgText }) {
  const atIso = nowIso();
  const preview = safeStr(msgText || "").slice(0, 120);

  const patch = {
    lastMessageAt: atIso,
    lastMessagePreview: preview
  };

  return prisma.conversation.update({
    where: { id: convRow.id },
    data: {
      lastMessageAt: new Date(atIso),
      metadata: setMeta(convRow, patch)
    }
  });
}

export async function appendMessage(dbOrConversationId, conversationIdOrRaw, maybeRaw) {
  // compat:
  // appendMessage(db, conversationId, rawMsg)  OR  appendMessage(conversationId, rawMsg)
  const conversationId =
    typeof dbOrConversationId === "string"
      ? dbOrConversationId
      : String(conversationIdOrRaw || "");

  const rawMsg =
    typeof dbOrConversationId === "string" ? conversationIdOrRaw : maybeRaw;

  if (!conversationId) return { ok: false, error: "conversationId obrigatório" };

  const convRow = await prisma.conversation.findUnique({
    where: { id: conversationId }
  });

  if (!convRow) return { ok: false, error: "Conversa não encontrada" };

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

  // cria message no Prisma
  const createdAtIso = rawMsg?.createdAt || rawMsg?.timestamp || nowIso();

  const msgRow = await prisma.message.create({
    data: {
      id: rawMsg?.id || newId("msg"),
      tenantId: convRow.tenantId,
      conversationId: convRow.id,

      direction: safeStr(direction),
      type: type || "text",
      text: text || null,

      // campos nativos opcionais
      mediaUrl: rawMsg?.mediaUrl || null,
      fromName: rawMsg?.fromName || null,
      fromId: rawMsg?.fromId || null,
      status: rawMsg?.status || "sent",

      metadata: {
        // tudo que faltaria em colunas vira metadata (paridade com legado)
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

  // atualiza counters/estado (bot/handoff/inbox) em Conversation.metadata
  const convMeta = getMeta(convRow);

  if (from === "bot") {
    const nextBotAttempts = Number(convMeta.botAttempts || 0) + 1;
    await prisma.conversation.update({
      where: { id: convRow.id },
      data: {
        metadata: setMeta(convRow, {
          botAttempts: nextBotAttempts,
          currentMode: "bot"
        })
      }
    });
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
    const tenantId = pickTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId não resolvido" });

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
    const tenantId = pickTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId não resolvido" });

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
    const tenantId = pickTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenantId não resolvido" });

    // valida conversa pertence ao tenant
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

export default router;
