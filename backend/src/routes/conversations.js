// backend/src/routes/conversations.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import multer from "multer";
import FormData from "form-data";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

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
// ⚠️ NÃO “congele” env no topo do módulo.
// Esse router é importado antes do dotenv em alguns setups.
// Sempre leia process.env em runtime.
function getWaConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();

  // ✅ fonte oficial: WHATSAPP_PHONE_NUMBER_ID
  // ✅ compat: PHONE_NUMBER_ID (caso exista em algum ambiente antigo)
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();

  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v20.0").trim();

  return { token, phoneNumberId, apiVersion };
}

function assertWhatsAppConfigured() {
  const { token, phoneNumberId } = getWaConfig();
  if (!token || !phoneNumberId) {
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

async function sendWhatsAppText({ to, text, timeoutMs = 12000 }) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!to) throw new Error("WhatsApp: destinatário inválido (waId/phone vazio)");
  if (!text) return {};

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: text }
  };

  // timeout para não travar request e gerar 502 no proxy
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp send timeout (${timeoutMs}ms)`
        : `WhatsApp send network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp send falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  // Graph geralmente retorna JSON; se vier vazio, ok
  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

// ======================================================
// ✅ ADD: WhatsApp send AUDIO + IMAGE + LOCATION
// (sem mexer no sendWhatsAppText)
// ======================================================
async function sendWhatsAppAudio({ to, audioUrl, timeoutMs = 20000 }) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!to) throw new Error("WhatsApp: destinatário inválido (waId/phone vazio)");
  if (!audioUrl) throw new Error("WhatsApp audio: mediaUrl/link obrigatório");

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "audio",
    audio: { link: audioUrl } // precisa ser URL pública acessível pela Meta
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp audio timeout (${timeoutMs}ms)`
        : `WhatsApp audio network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp audio falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

async function sendWhatsAppImage({ to, imageUrl, caption, timeoutMs = 20000 }) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!to) throw new Error("WhatsApp: destinatário inválido");
  if (!imageUrl) throw new Error("WhatsApp image: imageUrl obrigatório");

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "image",
    image: {
      link: imageUrl,
      caption: caption || undefined
    }
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp image timeout (${timeoutMs}ms)`
        : `WhatsApp image network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp image falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

async function sendWhatsAppLocation({ to, location, timeoutMs = 12000 }) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!to) throw new Error("WhatsApp: destinatário inválido (waId/phone vazio)");
  const lat = Number(location?.latitude ?? location?.lat);
  const lng = Number(location?.longitude ?? location?.lng ?? location?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("WhatsApp location: latitude/longitude inválidos");
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "location",
    location: {
      latitude: lat,
      longitude: lng,
      name: location?.name || undefined,
      address: location?.address || undefined
    }
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp location timeout (${timeoutMs}ms)`
        : `WhatsApp location network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp location falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

// ======================================================
// ✅ ADD: UPLOAD MEDIA (Graph) + SEND POR MEDIA_ID
// - Resolve o caso "front envia arquivo" (multipart)
// - Mantém tudo que já existe
// ======================================================
async function uploadWhatsAppMedia({
  buffer,
  mimeType,
  filename,
  timeoutMs = 20000
}) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!buffer || !buffer.length) throw new Error("WhatsApp media upload: buffer vazio");
  if (!mimeType) throw new Error("WhatsApp media upload: mimeType obrigatório");

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/media`;

  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", buffer, {
    filename: filename || "file",
    contentType: mimeType
  });

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...form.getHeaders()
      },
      body: form,
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp media upload timeout (${timeoutMs}ms)`
        : `WhatsApp media upload network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp media upload falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  const mediaId = data?.id;
  if (!mediaId) throw new Error("WhatsApp media upload: resposta sem id");
  return { mediaId, raw: data };
}

async function sendWhatsAppMediaById({
  to,
  kind, // image|video|audio|document|sticker
  mediaId,
  caption,
  filename,
  timeoutMs = 20000
}) {
  assertWhatsAppConfigured();
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!to) throw new Error("WhatsApp: destinatário inválido (waId/phone vazio)");
  if (!mediaId) throw new Error("WhatsApp media: mediaId obrigatório");

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: kind
  };

  if (kind === "image") payload.image = { id: mediaId, caption: caption || undefined };
  if (kind === "video") payload.video = { id: mediaId, caption: caption || undefined };
  if (kind === "audio") payload.audio = { id: mediaId };
  if (kind === "sticker") payload.sticker = { id: mediaId };
  if (kind === "document") {
    payload.document = {
      id: mediaId,
      caption: caption || undefined,
      filename: filename || undefined
    };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let r;
  try {
    r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });
  } catch (e) {
    const msg =
      e?.name === "AbortError"
        ? `WhatsApp media send timeout (${timeoutMs}ms)`
        : `WhatsApp media send network error: ${String(e?.message || e)}`;
    throw new Error(msg);
  } finally {
    clearTimeout(t);
  }

  const rawText = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(
      `WhatsApp media send falhou (${r.status}): ${rawText || "sem detalhes"}`
    );
  }

  try {
    return rawText ? JSON.parse(rawText) : {};
  } catch {
    return {};
  }
}

/**
 * ✅ ENVIO REAL PARA O CANAL
 * - whatsapp: envia via Graph
 * - webchat: no-op (se você tiver websocket, plugue aqui)
 */
async function sendToChannel(conv, msg) {
  const source = String(conv?.source || conv?.channel || "").toLowerCase();
  const type = String(msg?.type || "text").toLowerCase();
  const text = String(msg?.text || "").trim();

  if (source === "whatsapp") {
    const to = normalizeWaTo(conv);

    // ✅ NOVO: se vier mediaId (upload via /media), envia por id
    const mediaId = msg?.payload?.mediaId;
    const fileName = msg?.payload?.filename;
    if (mediaId && ["image","video","audio","document","sticker"].includes(type)) {
      const waRes = await sendWhatsAppMediaById({
        to,
        kind: type,
        mediaId,
        caption: (type === "audio" || type === "sticker") ? undefined : (text || undefined),
        filename: type === "document" ? (fileName || undefined) : undefined
      });
      return { ok: true, channel: "whatsapp", wa: waRes };
    }

    // ✅ áudio (link)
    if (type === "audio") {
      const audioUrl =
        msg?.payload?.audioUrl ||
        msg?.payload?.mediaUrl ||
        msg?.payload?.link ||
        msg?.payload?.audio?.link ||
        "";
      const waRes = await sendWhatsAppAudio({
        to,
        audioUrl: String(audioUrl || "").trim()
      });
      return { ok: true, channel: "whatsapp", wa: waRes };
    }

    // ✅ imagem (link)
    if (type === "image") {
      const imageUrl =
        msg?.payload?.image?.link ||
        msg?.payload?.imageUrl ||
        msg?.payload?.mediaUrl ||
        msg?.payload?.link ||
        "";
      const waRes = await sendWhatsAppImage({
        to,
        imageUrl: String(imageUrl || "").trim(),
        caption: text || undefined
      });
      return { ok: true, channel: "whatsapp", wa: waRes };
    }

    // ✅ localização
    if (type === "location") {
      const waRes = await sendWhatsAppLocation({
        to,
        location: msg?.payload?.location || msg?.payload || {}
      });
      return { ok: true, channel: "whatsapp", wa: waRes };
    }

    // texto (padrão)
    if (!text) return { ok: true, skipped: true };
    const waRes = await sendWhatsAppText({ to, text });
    return { ok: true, channel: "whatsapp", wa: waRes };
  }

  // webchat ou outros canais: aqui você pode plugar websocket/eventbus depois
  if (!text && type === "text") return { ok: true, skipped: true };
  return { ok: true, channel: source || "unknown", noop: true };
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
  if (
    !db.messagesByConversation ||
    typeof db.messagesByConversation !== "object"
  ) {
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

  if (!conv.source)
    conv.source = normalizeSourceFromChannel(conv.channel) || "whatsapp";
  if (!conv.channel) conv.channel = conv.source;

  const lastPreview = String(conv.lastMessagePreview || "").toLowerCase();
  const closeEvidence =
    !!conv.closedAt ||
    String(conv.closedBy || "").toLowerCase() === "agent" ||
    String(conv.closedReason || "").toLowerCase().includes("manual") ||
    lastPreview.includes("atendimento encerrado");

  if (!conv.status) conv.status = closeEvidence ? "closed" : "open";
  conv.status =
    String(conv.status).toLowerCase() === "closed" ? "closed" : "open";

  if (!conv.createdAt) conv.createdAt = nowIso();
  if (!conv.updatedAt) conv.updatedAt = conv.createdAt;

  if (!conv.currentMode) conv.currentMode = "human";

  if (typeof conv.handoffActive !== "boolean") conv.handoffActive = false;
  if (!conv.handoffSince && conv.handoffActive)
    conv.handoffSince = conv.updatedAt || conv.createdAt;
  if (!conv.lastInboundAt) conv.lastInboundAt = null;
  if (!conv.lastAgentAt) conv.lastAgentAt = null;

  if (!conv.peerId) {
    if (conv.source === "webchat" && conv.visitorId)
      conv.peerId = `wc:${conv.visitorId}`;
    if (
      conv.source === "whatsapp" &&
      (conv.waId || conv.phone || conv.contactPhone)
    ) {
      conv.peerId = `wa:${conv.waId || conv.phone || conv.contactPhone}`;
    }
  }

  if (!Array.isArray(conv.tags)) conv.tags = [];
  if (typeof conv.notes !== "string") conv.notes = "";

  if (typeof conv.lastMessagePreview !== "string") conv.lastMessagePreview = "";
  if (!conv.lastMessageAt) conv.lastMessageAt = conv.updatedAt;

  if (typeof conv.botAttempts !== "number")
    conv.botAttempts = Number(conv.botAttempts || 0);
  if (typeof conv.hadHuman !== "boolean") conv.hadHuman = Boolean(conv.hadHuman);

  return conv;
}

function getConversationRef(db, id) {
  ensureDbShape(db);
  const wanted = String(id);

  let conv = db.conversations.find((c) => String(c?.id) === wanted);
  if (!conv)
    conv = db.conversations.find((c) => String(c?.sessionId || "") === wanted);

  if (!conv) return null;
  normalizeConversation(conv);
  return conv;
}

// ✅ helper pequeno para não quebrar stringify
function safeStringify(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeMsg(conv, raw) {
  const createdAt = raw.createdAt || raw.timestamp || raw.sentAt || nowIso();

  // ======================================================
  // ✅ detectar tipo e payload (audio/image/location/etc)
  // sem quebrar front: text continua string e payload é opcional
  // ======================================================
  let type = raw.type || "text";
  let payload = raw.payload || undefined;

  // location (whatsapp webhook costuma trazer raw.location)
  if (raw?.location && (type === "text" || !raw.type)) {
    type = "location";
    payload = {
      ...(payload || {}),
      location: {
        latitude: raw.location.latitude ?? raw.location.lat,
        longitude: raw.location.longitude ?? raw.location.lng ?? raw.location.lon,
        name: raw.location.name,
        address: raw.location.address
      }
    };
  }

  // image (whatsapp webhook)
  if ((raw?.image || raw?.media?.type === "image") && (type === "text" || !raw.type)) {
    type = "image";
    const i = raw.image || raw.media || {};
    payload = {
      ...(payload || {}),
      image: {
        id: i.id || i.mediaId || i.media_id,
        mimeType: i.mime_type || i.mimeType,
        sha256: i.sha256,
        link: i.link || i.url || i.mediaUrl || i.imageUrl
      }
    };
  }

  // audio (whatsapp webhook pode trazer raw.audio / raw.media / raw.voice)
  if (
    (raw?.audio || raw?.voice || raw?.media?.type === "audio") &&
    (type === "text" || !raw.type)
  ) {
    type = "audio";
    const a = raw.audio || raw.voice || raw.media || {};
    payload = {
      ...(payload || {}),
      audio: {
        id: a.id || a.mediaId || a.media_id,
        mimeType: a.mime_type || a.mimeType,
        sha256: a.sha256,
        // se seu webhook já baixa e publica, pode preencher aqui:
        link: a.link || a.url || a.mediaUrl || a.audioUrl
      }
    };
  }

  const extracted =
    raw?.text?.body ??
    raw?.text ??
    raw?.body ??
    raw?.message ??
    raw?.content ??
    raw?.caption ??
    "";

  // texto padrão
  let text = typeof extracted === "string" ? extracted : safeStringify(extracted);

  // se for location/audio/image e não tiver texto, cria um preview amigável
  if ((!text || !String(text).trim()) && type === "location") {
    const loc = payload?.location || raw?.location || {};
    const lat = loc.latitude ?? loc.lat;
    const lng = loc.longitude ?? loc.lng ?? loc.lon;
    text = `[localização] ${lat ?? "?"}, ${lng ?? "?"}${loc.name ? ` — ${loc.name}` : ""}`;
  }
  if ((!text || !String(text).trim()) && type === "audio") {
    text = "[áudio]";
  }
  if ((!text || !String(text).trim()) && type === "image") {
    text = "[imagem]";
  }

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
    type: type || "text",
    from,
    direction,
    isBot,
    isSystem: !!raw.isSystem,
    text,
    createdAt: typeof createdAt === "number" ? new Date(createdAt).toISOString() : createdAt,
    senderName: raw.senderName || raw.byName || raw.agentName || undefined,
    waMessageId,
    // ✅ campos de entrega (não quebra o front, só adiciona)
    delivery: raw.delivery || undefined,
    // ✅ payload opcional para mídia/localização
    payload: payload || undefined
  };
}

function touchConversation(conv, msg) {
  const at = nowIso();
  conv.updatedAt = at;
  conv.lastMessageAt = at;

  const preview = String(msg?.text || "").trim();
  conv.lastMessagePreview = preview
    ? preview.slice(0, 120)
    : conv.lastMessagePreview || "";
}

function computeKindFlags(conv, list) {
  const hasBotMsg = list.some(
    (m) => String(m?.from) === "bot" || m?.isBot === true
  );
  const hasHumanMsg = list.some((m) => String(m?.from) === "agent");

  const botAttempts = Number(conv?.botAttempts || 0);
  const hadHuman = Boolean(conv?.hadHuman);

  const mode = String(conv?.currentMode || "").toLowerCase();
  const assigned = Boolean(conv?.assignedUserId || conv?.assignedGroupId);
  const status = String(conv?.status || "").toLowerCase();
  const closedByAgent = String(conv?.closedBy || "").toLowerCase() === "agent";
  const closedManual = String(conv?.closedReason || "")
    .toLowerCase()
    .includes("manual");

  const computedHasBot = hasBotMsg || botAttempts > 0 || mode === "bot";
  const computedHasHuman =
    hasHumanMsg ||
    hadHuman ||
    mode === "human" ||
    assigned ||
    (status === "closed" && (closedByAgent || closedManual));

  return { hasBot: computedHasBot, hasHuman: computedHasHuman };
}

// ✅ Atualiza mensagem no array
function updateMessage(db, conversationId, msgId, patch) {
  const list = ensureConversationMessages(db, conversationId);
  const idx = list.findIndex((m) => String(m?.id) === String(msgId));
  if (idx >= 0) list[idx] = { ...list[idx], ...patch };
  return idx >= 0 ? list[idx] : null;
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
  if (
    msg.waMessageId &&
    list.some((m) => String(m.waMessageId || "") === String(msg.waMessageId))
  ) {
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
    const idPrefix =
      source === "webchat" ? "wc" : source === "whatsapp" ? "wa" : "conv";

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
      // ✅ salva primeiro, depois tenta enviar (para nunca perder mensagem)
      saveDB(db);

      try {
        const delivered = await sendToChannel(conv, r.msg);
        updateMessage(db, conv.id, r.msg.id, {
          delivery: {
            status: "sent",
            channel: delivered?.channel || conv.source,
            at: nowIso()
          }
        });
        saveDB(db);
      } catch (e) {
        console.error("Erro ao enviar timeout para o canal:", e);
        updateMessage(db, conv.id, r.msg.id, {
          delivery: { status: "failed", error: String(e?.message || e), at: nowIso() }
        });
        saveDB(db);
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
    runHandoffTimeoutSweep().catch((e) =>
      console.error("Erro no sweep de handoff:", e)
    );
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

  if (status !== "all")
    items = items.filter(
      (c) => String(c.status || "open").toLowerCase() === status
    );
  if (source !== "all")
    items = items.filter((c) => String(c.source || "").toLowerCase() === source);
  if (mode !== "all")
    items = items.filter(
      (c) => String(c.currentMode || "bot").toLowerCase() === mode
    );

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
  list.sort(
    (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
  );
  return res.json(list);
});

// POST /conversations/:id/messages  ✅ agora ENVIA pro WhatsApp (sem 502)
// ✅ suporta type=text|audio|image|location
router.post("/:id/messages", async (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = getConversationRef(db, req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.status) === "closed")
    return res.status(410).json({ error: "Conversa encerrada" });

  const type = String(req.body?.type || "text").toLowerCase();

  // ---- validação por tipo
  let text = String(req.body?.text || "").trim();
  let payload = undefined;

  if (type === "text") {
    if (!text) return res.status(400).json({ error: "text obrigatório" });
  }

  if (type === "audio") {
    const mediaUrl = String(req.body?.mediaUrl || req.body?.audioUrl || req.body?.link || "").trim();
    if (!mediaUrl) return res.status(400).json({ error: "mediaUrl obrigatório para type=audio" });
    payload = { audioUrl: mediaUrl };
    if (!text) text = "[áudio]";
  }

  if (type === "image") {
    const imageUrl = String(req.body?.mediaUrl || req.body?.imageUrl || req.body?.link || "").trim();
    if (!imageUrl) return res.status(400).json({ error: "mediaUrl obrigatório para type=image" });
    payload = { image: { link: imageUrl } };
    if (!text) text = "[imagem]";
  }

  if (type === "location") {
    const latitude = Number(
      req.body?.latitude ??
        req.body?.lat ??
        req.body?.location?.latitude ??
        req.body?.location?.lat
    );
    const longitude = Number(
      req.body?.longitude ??
        req.body?.lng ??
        req.body?.lon ??
        req.body?.location?.longitude ??
        req.body?.location?.lng ??
        req.body?.location?.lon
    );
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res
        .status(400)
        .json({ error: "latitude e longitude obrigatórios para type=location" });
    }
    const name = req.body?.name ?? req.body?.location?.name;
    const address = req.body?.address ?? req.body?.location?.address;
    payload = { location: { latitude, longitude, name, address } };
    if (!text)
      text = `[localização] ${latitude}, ${longitude}${name ? ` — ${name}` : ""}`;
  }

  if (!["text", "audio", "image", "location"].includes(type)) {
    return res.status(400).json({ error: "type inválido (use text|audio|image|location)" });
  }

  conv.hadHuman = true;
  conv.currentMode = "human";
  conv.handoffActive = true;
  if (!conv.handoffSince) conv.handoffSince = nowIso();

  const result = appendMessage(db, conv.id, {
    from: "agent",
    direction: "out",
    type,
    text,
    payload, // ✅ opcional
    senderName: req.body?.senderName || "Humano",
    channel: conv.channel || conv.source || "whatsapp",
    source: conv.source || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });

  // ✅ salva primeiro SEMPRE
  saveDB(db);

  // ✅ tenta enviar, mas nunca responde 502 (front não pode quebrar)
  try {
    const delivered = await sendToChannel(conv, result.msg);

    // tenta capturar id da Meta se vier
    const waMessageId =
      delivered?.wa?.messages?.[0]?.id ||
      delivered?.wa?.message_id ||
      delivered?.wa?.id ||
      undefined;

    const patched = updateMessage(db, conv.id, result.msg.id, {
      waMessageId: waMessageId || result.msg.waMessageId,
      delivery: {
        status: "sent",
        channel: delivered?.channel || conv.source,
        at: nowIso()
      }
    });

    saveDB(db);
    return res.status(201).json(patched || result.msg);
  } catch (err) {
    console.error("Erro ao enviar para o canal:", err);

    const patched = updateMessage(db, conv.id, result.msg.id, {
      delivery: { status: "failed", error: String(err?.message || err), at: nowIso() }
    });

    saveDB(db);

    // ✅ responde 201 mesmo com falha no envio (mensagem já está salva)
    return res.status(201).json({
      ...(patched || result.msg),
      delivery: { status: "failed", error: String(err?.message || err), at: nowIso() }
    });
  }
});

// ✅ NEW: POST /conversations/:id/media
// multipart/form-data: file + type + caption(opc) + filename(opc)
// type: audio|image|video|document|sticker
router.post("/:id/media", upload.single("file"), async (req, res) => {
  const db = ensureDbShape(loadDB());
  const conv = getConversationRef(db, req.params.id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.status) === "closed") {
    return res.status(410).json({ error: "Conversa encerrada" });
  }

  const type = String(req.body?.type || "").toLowerCase();
  const caption = String(req.body?.caption || "").trim();
  const senderName = req.body?.senderName || "Humano";

  if (!["audio", "image", "video", "document", "sticker"].includes(type)) {
    return res.status(400).json({
      error: "type inválido (use audio|image|video|document|sticker)"
    });
  }

  const file = req.file;
  if (!file?.buffer?.length) {
    return res.status(400).json({ error: "file obrigatório (multipart/form-data)" });
  }

  conv.hadHuman = true;
  conv.currentMode = "human";
  conv.handoffActive = true;
  if (!conv.handoffSince) conv.handoffSince = nowIso();

  // 1) upload no Graph -> mediaId
  let mediaId = null;
  try {
    const up = await uploadWhatsAppMedia({
      buffer: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || req.body?.filename || "file"
    });
    mediaId = up.mediaId;
  } catch (err) {
    const result = appendMessage(db, conv.id, {
      from: "agent",
      direction: "out",
      type,
      text:
        caption ||
        (type === "audio" ? "[áudio]" : type === "sticker" ? "[figurinha]" : `[${type}]`),
      payload: {
        filename: file.originalname,
        mimeType: file.mimetype,
        upload: "failed"
      },
      senderName,
      channel: conv.channel || conv.source || "whatsapp",
      source: conv.source || "whatsapp",
      delivery: { status: "failed", error: String(err?.message || err), at: nowIso() }
    });

    saveDB(db);
    return res.status(201).json(result.msg);
  }

  // 2) persiste msg local com mediaId e envia via sendToChannel()
  const result = appendMessage(db, conv.id, {
    from: "agent",
    direction: "out",
    type,
    text:
      caption ||
      (type === "audio" ? "[áudio]" : type === "sticker" ? "[figurinha]" : `[${type}]`),
    payload: {
      mediaId,
      filename: file.originalname,
      mimeType: file.mimetype
    },
    senderName,
    channel: conv.channel || conv.source || "whatsapp",
    source: conv.source || "whatsapp"
  });

  if (!result.ok) return res.status(400).json({ error: result.error });

  // salva primeiro
  saveDB(db);

  try {
    const delivered = await sendToChannel(conv, result.msg);

    const waMessageId =
      delivered?.wa?.messages?.[0]?.id ||
      delivered?.wa?.message_id ||
      delivered?.wa?.id ||
      undefined;

    const patched = updateMessage(db, conv.id, result.msg.id, {
      waMessageId: waMessageId || result.msg.waMessageId,
      delivery: { status: "sent", channel: delivered?.channel || conv.source, at: nowIso() }
    });

    saveDB(db);
    return res.status(201).json(patched || result.msg);
  } catch (err) {
    const patched = updateMessage(db, conv.id, result.msg.id, {
      delivery: { status: "failed", error: String(err?.message || err), at: nowIso() }
    });

    saveDB(db);
    return res.status(201).json(patched || result.msg);
  }
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

    // ✅ salva antes de tentar enviar
    saveDB(db);

    if (r?.ok && r?.msg) {
      try {
        const delivered = await sendToChannel(conv, r.msg);
        updateMessage(db, conv.id, r.msg.id, {
          delivery: {
            status: "sent",
            channel: delivered?.channel || conv.source,
            at: nowIso()
          }
        });
        saveDB(db);
      } catch (e) {
        console.error("Erro ao enviar mensagem de encerramento:", e);
        updateMessage(db, conv.id, r.msg.id, {
          delivery: { status: "failed", error: String(e?.message || e), at: nowIso() }
        });
        saveDB(db);
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
