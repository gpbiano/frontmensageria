import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

const router = express.Router();

// ======================================================
// CONFIG
// ======================================================
const CLOSE_MESSAGE_TEXT =
  "Atendimento encerrado ✅\n\n" +
  "Este atendimento foi finalizado pelo nosso time.\n" +
  "Se precisar de algo mais, é só enviar uma nova mensagem 😊";

// ======================================================
// HELPERS
// ======================================================
function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "msg") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureDbShape(db) {
  if (!db) db = {};
  if (!Array.isArray(db.conversations)) db.conversations = [];
  if (!db.messagesByConversation || typeof db.messagesByConversation !== "object") {
    db.messagesByConversation = {};
  }
  return db;
}

function ensureMessagesByConversation(db) {
  ensureDbShape(db);
  return db.messagesByConversation;
}

function ensureConversationMessages(db, conversationId) {
  const map = ensureMessagesByConversation(db);
  const key = String(conversationId);
  if (!Array.isArray(map[key])) map[key] = [];
  return map[key];
}

function normalizeSourceFromChannel(ch) {
  if (!ch) return "";
  const v = String(ch).toLowerCase();
  if (v.includes("webchat")) return "webchat";
  if (v.includes("whatsapp")) return "whatsapp";
  return v;
}

/**
 * MODELO A: multi-canal paralelo
 * - não mistura canais
 * - regra do projeto: conversa fechada NÃO reabre (nova sessão)
 */
function normalizeConversation(conv) {
  if (!conv) return conv;

  // ✅ id sempre string
  if (conv.id != null) conv.id = String(conv.id);

  if (!conv.source) conv.source = normalizeSourceFromChannel(conv.channel) || "whatsapp";
  if (!conv.channel) conv.channel = conv.source;

  if (!conv.status) conv.status = "open";
  if (!conv.createdAt) conv.createdAt = nowIso();
  if (!conv.updatedAt) conv.updatedAt = conv.createdAt;

  if (!conv.currentMode) conv.currentMode = "human";

  if (!conv.peerId) {
    if (conv.source === "webchat" && conv.visitorId) conv.peerId = `wc:${conv.visitorId}`;
    if (conv.source === "whatsapp" && (conv.waId || conv.phone || conv.contactPhone)) {
      conv.peerId = `wa:${conv.waId || conv.phone || conv.contactPhone}`;
    }
  }

  if (!Array.isArray(conv.tags)) conv.tags = [];
  if (typeof conv.notes !== "string") conv.notes = "";

  if (typeof conv.lastMessagePreview !== "string") conv.lastMessagePreview = "";
  if (!conv.lastMessageAt) conv.lastMessageAt = conv.updatedAt;

  return conv;
}

function getConversation(db, id) {
  const convs = ensureArray(db.conversations).map(normalizeConversation);
  const wanted = String(id);

  // ✅ busca principal por id (string)
  let conv = convs.find((c) => String(c.id) === wanted);

  // ✅ fallback: se alguém mandar sessionId por engano
  if (!conv) {
    conv = convs.find((c) => String(c.sessionId || "") === wanted);
  }

  return conv ? normalizeConversation(conv) : null;
}

/**
 * ✅ Padroniza SEMPRE msg.text como STRING (evita “mensagem vazia” no front)
 */
function normalizeMsg(conv, raw) {
  const createdAt = raw.createdAt || raw.timestamp || raw.sentAt || nowIso();

  const extracted =
    raw?.text?.body ??
    raw?.text ??
    raw?.body ??
    raw?.message ??
    raw?.content ??
    raw?.caption ??
    "";

  const text = typeof extracted === "string" ? extracted : JSON.stringify(extracted);

  let from = raw.from || raw.sender || raw.author || null;
  let direction = raw.direction || null;

  if (from === "user" || from === "contact" || from === "visitor") from = "client";
  if (from === "attendant" || from === "human") from = "agent";

  const waMessageId = raw.waMessageId || raw.messageId || raw.metaMessageId || undefined;
  const isBot = !!(raw.isBot || raw.fromBot || raw.bot === true || from === "bot");

  if (!direction) {
    if (from === "client") direction = "in";
    else direction = "out";
  }
  if (!from) from = direction === "in" ? "client" : "agent";
  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || raw._id || newId("msg"),
    conversationId: String(raw.conversationId || conv?.id || ""),
    channel: raw.channel || conv?.channel || conv?.source || "whatsapp",
    source: raw.source || conv?.source || raw.channel || "whatsapp",
    type: raw.type || "text",
    from,
    direction,
    isBot,
    isSystem: !!raw.isSystem,
    text,
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt,
    senderName: raw.senderName || raw.byName || raw.agentName || undefined,
    waMessageId
  };
}

function touchConversation(conv, msg) {
  const at = nowIso();
  conv.updatedAt = at;
  conv.lastMessageAt = at;

  const preview = String(msg?.text || "").trim();
  conv.lastMessagePreview = preview ? preview.slice(0, 120) : conv.lastMessagePreview || "";
}

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.warn(
      "[conversationsRouter] WHATSAPP_TOKEN/PHONE_NUMBER_ID ausentes. Mensagem não enviada."
    );
    return { ok: false, skipped: true };
  }

  const fetchFn = globalThis.fetch;
  if (!fetchFn) {
    throw new Error("fetch não disponível (Node < 18). Use Node 18+ ou habilite polyfill.");
  }

  const url = `https://graph.facebook.com/v22.0/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body }
  };

  const resp = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    console.warn("[conversationsRouter] Erro ao enviar WhatsApp:", data);
    return { ok: false, error: data };
  }

  return { ok: true, data };
}

// ======================================================
// CORE: Funções exportadas p/ canais
// ======================================================

/**
 * ✅ Função ÚNICA para anexar mensagem em qualquer canal
 * ✅ NÃO duplica por id nem por waMessageId
 * ⚠️ Não salva aqui — quem chama decide quando salvar (evita race)
 */
export function appendMessage(db, conversationId, rawMsg) {
  db = ensureDbShape(db);

  const conv = getConversation(db, conversationId);
  if (!conv) return { ok: false, error: "Conversa não encontrada" };

  const list = ensureConversationMessages(db, conv.id);
  const msg = normalizeMsg(conv, { ...rawMsg, conversationId: String(conv.id) });

  if (msg.id && list.some((m) => String(m.id) === String(msg.id))) {
    return { ok: true, msg, duplicated: true };
  }

  if (msg.waMessageId && list.some((m) => String(m.waMessageId || "") === String(msg.waMessageId))) {
    return { ok: true, msg, duplicated: true };
  }

  list.push(msg);

  // ✅ se chegou mensagem inbound e a conversa estava closed, NÃO reabre aqui
  // (regras de sessão nova são tratadas no getOrCreateChannelConversation)
  touchConversation(conv, msg);

  return { ok: true, msg };
}

/**
 * MODELO A:
 * - cria conversa SOMENTE do canal informado
 * - ✅ se existir conversa OPEN para o mesmo peerId/source: reutiliza
 * - ✅ se existir apenas CLOSED: cria NOVA sessão (regra)
 */
export function getOrCreateChannelConversation(db, payload) {
  db = ensureDbShape(db);

  const source = String(payload?.source || "").toLowerCase();
  if (!source) return { ok: false, error: "source obrigatório" };

  const peerId = String(payload?.peerId || "").trim();
  if (!peerId) return { ok: false, error: "peerId obrigatório" };

  const accountId = payload?.accountId ? String(payload.accountId) : null;

  // 1) tenta achar conversa ABERTA do mesmo canal + peerId
  let conv = db.conversations.find((c) => {
    normalizeConversation(c);
    return (
      String(c.status || "open") === "open" &&
      String(c.source || "") === source &&
      String(c.peerId || "") === peerId &&
      (accountId ? String(c.accountId || "") === accountId : true)
    );
  });

  // 2) se não achou aberta, cria NOVA (mesmo se existir fechada)
  if (!conv) {
    const idPrefix = source === "webchat" ? "wc" : source === "whatsapp" ? "wa" : "conv";

    conv = {
      id: newId(idPrefix), // ✅ string
      source,
      channel: source,
      peerId,
      title: payload?.title || "Contato",
      status: "open",
      currentMode: payload?.currentMode || "human",
      assignedGroupId: null,
      assignedUserId: null,
      notes: "",
      tags: [],
      accountId: accountId || null,
      channelId: payload?.channelId ? String(payload.channelId) : null,
      phone: payload?.phone || null,
      waId: payload?.waId || null,
      visitorId: payload?.visitorId || null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      lastMessageAt: null,
      lastMessagePreview: ""
    };

    db.conversations.push(conv);
    ensureConversationMessages(db, conv.id);
  }

  normalizeConversation(conv);
  return { ok: true, conversation: conv };
}

// ======================================================
// ROUTES
// ======================================================

// GET /conversations?status=open|closed|all&source=whatsapp|webchat|all&mode=human|bot|all
router.get("/", (req, res) => {
  const db = ensureDbShape(loadDB());
  const status = String(req.query.status || "open").toLowerCase();
  const source = String(req.query.source || "all").toLowerCase();
  const mode = String(req.query.mode || "all").toLowerCase();

  let items = ensureArray(db.conversations).map(normalizeConversation);

  if (status !== "all") {
    items = items.filter((c) => String(c.status || "open").toLowerCase() === status);
  }
  if (source !== "all") {
    items = items.filter((c) => String(c.source || "").toLowerCase() === source);
  }
  if (mode !== "all") {
    items = items.filter((c) => String(c.currentMode || "human").toLowerCase() === mode);
  }

  // ✅ Para "Atendimento" (open): só mostra conversas que já tiveram inbound
  // (evita “fantasma travada” aberta sem mensagem)
  if (status === "open") {
    items = items.filter((c) => {
      const list = db.messagesByConversation?.[String(c.id)] || [];
      return list.some((m) => String(m.direction) === "in");
    });
  }

  items.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return res.json(items);
});

// GET /conversations/:id/messages
router.get("/:id/messages", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, conv.id);

  list.sort((a, b) => {
    const ta = new Date(a.createdAt || 0).getTime();
    const tb = new Date(b.createdAt || 0).getTime();
    return ta - tb;
  });

  return res.json(list);
});

// POST /conversations/:id/messages  (envio humano/atendente)
// body: { text: string, senderName?: string }
router.post("/:id/messages", async (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.status) === "closed") {
    return res.status(410).json({ error: "Conversa encerrada" });
  }

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text obrigatório" });

  if (conv.source === "whatsapp") {
    const to =
      conv.waId ||
      conv.phone ||
      (conv.peerId?.startsWith("wa:") ? conv.peerId.slice(3) : null);

    if (to) {
      await sendWhatsAppText(String(to), text);
    } else {
      console.warn(
        "[conversationsRouter] Conversa whatsapp sem waId/phone/peerId válido, não enviou."
      );
    }
  }

  const result = appendMessage(db, conv.id, {
    from: "agent",
    direction: "out",
    type: "text",
    text,
    senderName: req.body?.senderName || undefined,
    channel: conv.channel || conv.source || "whatsapp",
    source: conv.source || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });

  // ✅ salva 1x
  saveDB(db);

  return res.json(result.msg);
});

// PATCH /conversations/:id/status
// body: { status: "open" | "closed", tags?: string[] }
// Regras:
// - Ao fechar: envia msg ao cliente (WhatsApp) + persiste msg + fecha
// - ✅ NÃO permite reabrir conversa fechada
router.patch("/:id/status", async (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const status = String(req.body?.status || "").trim().toLowerCase();
  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "status inválido (use open|closed)" });
  }

  if (Array.isArray(req.body?.tags)) conv.tags = req.body.tags;

  const wasClosed = String(conv.status) === "closed";

  if (wasClosed && status === "open") {
    return res.status(409).json({
      error:
        "Conversa encerrada não pode ser reaberta. Se o cliente enviar nova mensagem, abriremos uma nova sessão."
    });
  }

  if (status === "closed" && !wasClosed) {
    if (conv.source === "whatsapp") {
      const to =
        conv.waId ||
        conv.phone ||
        (conv.peerId?.startsWith("wa:") ? conv.peerId.slice(3) : null);

      if (to) await sendWhatsAppText(String(to), CLOSE_MESSAGE_TEXT);
    }

    appendMessage(db, conv.id, {
      type: "system",
      from: "system",
      direction: "out",
      text: CLOSE_MESSAGE_TEXT,
      isSystem: true,
      channel: conv.channel || conv.source || "whatsapp",
      source: conv.source || "whatsapp"
    });

    conv.status = "closed";
    conv.closedAt = nowIso();
    conv.closedBy = "agent";
    conv.closedReason = "manual_by_agent";
    conv.updatedAt = nowIso();

    saveDB(db);
    return res.json(conv);
  }

  // open->open
  conv.updatedAt = nowIso();
  saveDB(db);
  return res.json(conv);
});

// PATCH /conversations/:id/notes
router.patch("/:id/notes", (req, res) => {
  const db = ensureDbShape(loadDB());
  const id = String(req.params.id);

  const conv = getConversation(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.notes = String(req.body?.notes || "");
  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json(conv);
});

export default router;
