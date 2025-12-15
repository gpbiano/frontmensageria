// backend/src/routes/conversations.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

const router = express.Router();

// ======================================================
// CONFIG
// ======================================================
const CLOSE_MESSAGE_TEXT =
  "Atendimento encerrado ✅\n\n" +
  "Este atendimento foi finalizado pelo nosso time.\n" +
  "Se precisar de algo mais, é só enviar uma nova mensagem 😊";

const HANDOFF_TIMEOUT_MESSAGE_TEXT =
  "Tudo bem 😊\n" +
  "Vou te direcionar novamente para o atendimento automático 🤖\n\n" +
  "Se precisar falar com um atendente, é só escrever “humano” aqui na conversa.";

const HANDOFF_TIMEOUT_MS = 10 * 60 * 1000; // ✅ 10 min

// ======================================================
// WHATSAPP SENDER (Meta Graph API)
// ======================================================
const WA_TOKEN = process.env.WHATSAPP_TOKEN || "";
const WA_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WA_API_VERSION = process.env.WHATSAPP_API_VERSION || "v20.0";

function assertWhatsAppConfigured() {
  if (!WA_TOKEN || !WA_PHONE_NUMBER_ID) {
    throw new Error(
      "WhatsApp não configurado: defina WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no .env"
    );
  }
}

function normalizeWaTo(conv) {
  // conv.peerId pode vir como "wa:5564..." -> queremos só dígitos
  const raw =
    conv?.waId ||
    conv?.phone ||
    conv?.contactPhone ||
    (String(conv?.peerId || "").startsWith("wa:")
      ? String(conv.peerId).slice(3)
      : "");

  const digits = String(raw || "").replace(/\D/g, "");
  return digits || null;
}

async function sendWhatsAppText({ to, text }) {
  assertWhatsAppConfigured();
  if (!to) throw new Error("WhatsApp: destinatário inválido (waId/phone vazio)");
  if (!text) return;

  const url = `https://graph.facebook.com/${WA_API_VERSION}/${WA_PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: text }
  };

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WA_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const errText = await r.text().catch(() => "");
    throw new Error(`WhatsApp send falhou (${r.status}): ${errText || "sem detalhes"}`);
  }

  return r.json().catch(() => ({}));
}

/**
 * ✅ ENVIO REAL PARA O CANAL
 * - whatsapp: envia via Graph
 * - webchat: no-op (se você tiver websocket, plugue aqui)
 */
async function sendToChannel(conv, msg) {
  const source = String(conv?.source || conv?.channel || "").toLowerCase();
  const text = String(msg?.text || "").trim();

  if (!text) return;

  if (source === "whatsapp") {
    const to = normalizeWaTo(conv);
    await sendWhatsAppText({ to, text });
    return;
  }

  // webchat ou outros canais: aqui você pode plugar websocket/eventbus depois
  return;
}

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

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isHumanHandoffRequest(text) {
  const t = normalizeText(text);

  if (t.includes("falar com humano")) return true;
  if (t.includes("quero um humano")) return true;
  if (t.includes("quero falar com atendente")) return true;
  if (t.includes("atendente")) return true;
  if (t.includes("pessoa")) return true;
  if (t.includes("humano")) return true;
  if (t.includes("suporte humano")) return true;

  if (t === "humano" || t === "atendente" || t === "agente") return true;

  return false;
}

function normalizeConversation(conv) {
  if (!conv) return conv;

  if (conv.id != null) conv.id = String(conv.id);

  if (!conv.source) conv.source = normalizeSourceFromChannel(conv.channel) || "whatsapp";
  if (!conv.channel) conv.channel = conv.source;

  const lastPreview = String(conv.lastMessagePreview || "").toLowerCase();
  const closeEvidence =
    !!conv.closedAt ||
    String(conv.closedBy || "").toLowerCase() === "agent" ||
    String(conv.closedReason || "").toLowerCase().includes("manual") ||
    lastPreview.includes("atendimento encerrado");

  if (!conv.status) conv.status = closeEvidence ? "closed" : "open";
  conv.status = String(conv.status).toLowerCase() === "closed" ? "closed" : "open";

  if (!conv.createdAt) conv.createdAt = nowIso();
  if (!conv.updatedAt) conv.updatedAt = conv.createdAt;

  if (!conv.currentMode) conv.currentMode = "human";

  if (typeof conv.handoffActive !== "boolean") conv.handoffActive = false;
  if (!conv.handoffSince && conv.handoffActive) conv.handoffSince = conv.updatedAt || conv.createdAt;
  if (!conv.lastInboundAt) conv.lastInboundAt = null;
  if (!conv.lastAgentAt) conv.lastAgentAt = null;

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

  if (typeof conv.botAttempts !== "number") conv.botAttempts = Number(conv.botAttempts || 0);
  if (typeof conv.hadHuman !== "boolean") conv.hadHuman = Boolean(conv.hadHuman);

  return conv;
}

function getConversationRef(db, id) {
  ensureDbShape(db);
  const wanted = String(id);

  let conv = db.conversations.find((c) => String(c?.id) === wanted);
  if (!conv) conv = db.conversations.find((c) => String(c?.sessionId || "") === wanted);

  if (!conv) return null;
  normalizeConversation(conv);
  return conv;
}

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

  const isBot = !!(raw.isBot || raw.fromBot || raw.bot === true || from === "bot");
  const waMessageId = raw.waMessageId || raw.messageId || raw.metaMessageId || undefined;

  if (!direction) direction = from === "client" ? "in" : "out";
  if (!from) from = direction === "in" ? "client" : "agent";

  if (isBot) {
    from = "bot";
    direction = "out";
  }

  return {
    id: raw.id || raw._id || newId("msg"),
    conversationId: String(raw.conversationId || conv.id),
    channel: raw.channel || conv.channel || conv.source || "whatsapp",
    source: raw.source || conv.source || raw.channel || "whatsapp",
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

function computeKindFlags(conv, list) {
  const hasBotMsg = list.some((m) => String(m?.from) === "bot" || m?.isBot === true);
  const hasHumanMsg = list.some((m) => String(m?.from) === "agent");

  const botAttempts = Number(conv?.botAttempts || 0);
  const hadHuman = Boolean(conv?.hadHuman);

  const mode = String(conv?.currentMode || "").toLowerCase();
  const assigned = Boolean(conv?.assignedUserId || conv?.assignedGroupId);
  const status = String(conv?.status || "").toLowerCase();
  const closedByAgent = String(conv?.closedBy || "").toLowerCase() === "agent";
  const closedManual = String(conv?.closedReason || "").toLowerCase().includes("manual");

  const computedHasBot = hasBotMsg || botAttempts > 0 || mode === "bot";
  const computedHasHuman =
    hasHumanMsg ||
    hadHuman ||
    mode === "human" ||
    assigned ||
    (status === "closed" && (closedByAgent || closedManual));

  return { hasBot: computedHasBot, hasHuman: computedHasHuman };
}

// ======================================================
// CORE (exportado)
// ======================================================
export function appendMessage(db, conversationId, rawMsg) {
  db = ensureDbShape(db);

  const conv = getConversationRef(db, conversationId);
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

  if (msg.from === "client" && msg.direction === "in") {
    conv.lastInboundAt = msg.createdAt || nowIso();
  }
  if (msg.from === "agent" && msg.direction === "out") {
    conv.lastAgentAt = msg.createdAt || nowIso();
  }

  if (msg.from === "client" && isHumanHandoffRequest(msg.text)) {
    conv.currentMode = "human";
    conv.handoffActive = true;
    if (!conv.handoffSince) conv.handoffSince = nowIso();
    conv.handoffRequestedAt = nowIso();
    conv.handoffReason = "user_request";
  }

  if (msg.from === "bot" || msg.isBot) {
    conv.botAttempts = Number(conv.botAttempts || 0) + 1;
  }

  if (msg.from === "agent") {
    conv.hadHuman = true;
    conv.currentMode = "human";
    conv.handoffActive = true;
    if (!conv.handoffSince) conv.handoffSince = nowIso();
  }

  touchConversation(conv, msg);
  return { ok: true, msg };
}

export function getOrCreateChannelConversation(db, payload) {
  db = ensureDbShape(db);

  const source = String(payload?.source || "").toLowerCase();
  if (!source) return { ok: false, error: "source obrigatório" };

  const peerId = String(payload?.peerId || "").trim();
  if (!peerId) return { ok: false, error: "peerId obrigatório" };

  const accountId = payload?.accountId ? String(payload.accountId) : null;

  let conv = db.conversations.find((c) => {
    normalizeConversation(c);
    return (
      String(c.status || "open") === "open" &&
      String(c.source || "") === source &&
      String(c.peerId || "") === peerId &&
      (accountId ? String(c.accountId || "") === accountId : true)
    );
  });

  if (!conv) {
    const idPrefix = source === "webchat" ? "wc" : source === "whatsapp" ? "wa" : "conv";

    conv = {
      id: newId(idPrefix),
      source,
      channel: source,
      peerId,
      title: payload?.title || "Contato",
      status: "open",

      currentMode: payload?.currentMode || "bot",
      handoffActive: false,
      handoffSince: null,
      handoffEndedAt: null,

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
      lastMessagePreview: "",
      botAttempts: 0,
      hadHuman: false,

      lastInboundAt: null,
      lastAgentAt: null
    };

    db.conversations.push(conv);
    ensureConversationMessages(db, conv.id);
  }

  normalizeConversation(conv);
  return { ok: true, conversation: conv };
}

// ======================================================
// HANDOFF TIMEOUT JOB (10 min)
// ======================================================
async function runHandoffTimeoutSweep() {
  const db = ensureDbShape(loadDB());
  const items = ensureArray(db.conversations);
  items.forEach(normalizeConversation);

  const now = Date.now();
  let changed = false;

  for (const conv of items) {
    if (String(conv.status || "open") !== "open") continue;

    if (String(conv.currentMode || "bot").toLowerCase() !== "human") continue;
    if (conv.handoffActive !== true) continue;
    if (!conv.lastInboundAt) continue;

    const lastInboundMs = new Date(conv.lastInboundAt).getTime();
    if (!Number.isFinite(lastInboundMs)) continue;

    if (now - lastInboundMs < HANDOFF_TIMEOUT_MS) continue;

    const r = appendMessage(db, conv.id, {
      from: "system",
      direction: "out",
      type: "system",
      text: HANDOFF_TIMEOUT_MESSAGE_TEXT,
      isSystem: true,
      channel: conv.channel || conv.source || "whatsapp",
      source: conv.source || "whatsapp"
    });

    if (r?.ok && r?.msg) {
      try {
        await sendToChannel(conv, r.msg);
      } catch (e) {
        console.error("Erro ao enviar timeout para o canal:", e);
      }
    }

    conv.currentMode = "bot";
    conv.handoffActive = false;
    conv.handoffEndedAt = nowIso();
    conv.updatedAt = nowIso();

    changed = true;
  }

  if (changed) saveDB(db);
}

if (!globalThis.__gp_handoff_timer_started) {
  globalThis.__gp_handoff_timer_started = true;
  setInterval(() => {
    runHandoffTimeoutSweep().catch((e) => console.error("Erro no sweep de handoff:", e));
  }, 60 * 1000);
}

// ======================================================
// ROUTES
// ======================================================

// GET /conversations
router.get("/", (req, res) => {
  const db = ensureDbShape(loadDB());

  const status = String(req.query.status || "open").toLowerCase();
  const source = String(req.query.source || "all").toLowerCase();
  const mode = String(req.query.mode || "all").toLowerCase();
  const kind = String(req.query.kind || "all").toLowerCase();

  let items = ensureArray(db.conversations);
  items.forEach(normalizeConversation);

  if (status !== "all") items = items.filter((c) => String(c.status || "open").toLowerCase() === status);
  if (source !== "all") items = items.filter((c) => String(c.source || "").toLowerCase() === source);
  if (mode !== "all") items = items.filter((c) => String(c.currentMode || "bot").toLowerCase() === mode);

  if (kind !== "all") {
    items = items.filter((c) => {
      const list = db.messagesByConversation?.[String(c.id)] || [];
      const { hasBot, hasHuman } = computeKindFlags(c, list);
      if (kind === "bot") return hasBot;
      if (kind === "human") return hasHuman;
      if (kind === "bot_only") return hasBot && !hasHuman;
      if (kind === "human_only") return hasHuman && !hasBot;
      return true;
    });
  }

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
  const conv = getConversationRef(db, req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  const list = ensureConversationMessages(db, conv.id).slice();
  list.sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
  return res.json(list);
});

// POST /conversations/:id/messages  ✅ agora ENVIA pro WhatsApp
router.post("/:id/messages", async (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = getConversationRef(db, req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.status) === "closed") return res.status(410).json({ error: "Conversa encerrada" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text obrigatório" });

  conv.hadHuman = true;
  conv.currentMode = "human";
  conv.handoffActive = true;
  if (!conv.handoffSince) conv.handoffSince = nowIso();

  const result = appendMessage(db, conv.id, {
    from: "agent",
    direction: "out",
    type: "text",
    text,
    senderName: req.body?.senderName || "Humano",
    channel: conv.channel || conv.source || "whatsapp",
    source: conv.source || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });

  try {
    await sendToChannel(conv, result.msg);
  } catch (err) {
    console.error("Erro ao enviar para o canal:", err);
    saveDB(db);
    return res.status(502).json({
      error: "Mensagem salva, mas falha ao enviar para o canal",
      details: String(err?.message || err)
    });
  }

  saveDB(db);
  return res.json(result.msg);
});

// PATCH /conversations/:id/status
router.patch("/:id/status", async (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = getConversationRef(db, req.params.id);
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
    conv.hadHuman = true;

    const r = appendMessage(db, conv.id, {
      from: "system",
      direction: "out",
      type: "system",
      text: CLOSE_MESSAGE_TEXT,
      isSystem: true,
      channel: conv.channel || conv.source || "whatsapp",
      source: conv.source || "whatsapp"
    });

    if (r?.ok && r?.msg) {
      try {
        await sendToChannel(conv, r.msg);
      } catch (e) {
        console.error("Erro ao enviar mensagem de encerramento:", e);
      }
    }

    conv.status = "closed";
    conv.closedAt = nowIso();
    conv.closedBy = "agent";
    conv.closedReason = "manual_by_agent";

    conv.currentMode = "bot";
    conv.handoffActive = false;
    conv.handoffEndedAt = nowIso();
    conv.updatedAt = nowIso();

    saveDB(db);
    return res.json(conv);
  }

  conv.updatedAt = nowIso();
  saveDB(db);
  return res.json(conv);
});

// PATCH /conversations/:id/notes
router.patch("/:id/notes", (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = getConversationRef(db, req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  conv.notes = String(req.body?.notes || "");
  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json(conv);
});

export default router;
