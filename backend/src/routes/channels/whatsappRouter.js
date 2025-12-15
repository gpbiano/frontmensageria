// backend/src/routes/webhook/whatsappRouter.js
import express from "express";
import logger from "../../logger.js";
import { loadDB, saveDB, ensureArray } from "../../utils/db.js";

import {
  getChatbotSettingsForAccount,
  decideRoute
} from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

// ✅ CORE OFICIAL (conversas + persistência)
import {
  getOrCreateChannelConversation,
  appendMessage
} from "../conversations.js"; // <-- AJUSTE O CAMINHO SE PRECISAR

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

function nowIso() {
  return new Date().toISOString();
}

function ensureDbShape(db) {
  db.users = ensureArray(db.users);
  db.contacts = ensureArray(db.contacts);
  db.conversations = ensureArray(db.conversations);
  db.messagesByConversation =
    db.messagesByConversation && typeof db.messagesByConversation === "object"
      ? db.messagesByConversation
      : {};
  db.settings = db.settings || { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
  db.outboundCampaigns = ensureArray(db.outboundCampaigns);
  return db;
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

// ======================================================
// ✅ WhatsApp ENV (runtime — evita “congelar” env)
// ======================================================
function getWaConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  // compat: PHONE_NUMBER_ID antigo
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  return { token, phoneNumberId, apiVersion };
}

function getPublicApiBaseUrl(req) {
  // se você tiver um domínio público, defina no env:
  // PUBLIC_API_BASE_URL=https://api.gplabs.com.br
  const envBase = String(process.env.PUBLIC_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (envBase) return envBase;

  // fallback: tenta inferir (em dev pode ficar http://localhost:3010 etc)
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  return `${proto}://${host}`;
}

// ======================================================
// ✅ Media helpers (resolver URL e servir como proxy)
// - Cloud API manda media_id no webhook (áudio/imagem/sticker/etc)
// - Precisamos resolver URL via Graph e servir o binário pro front
// ======================================================
async function getWhatsAppMediaMetadata(mediaId, { timeoutMs = 12000 } = {}) {
  const { token, apiVersion } = getWaConfig();
  if (!token) throw new Error("WHATSAPP_TOKEN ausente (não dá pra resolver mídia)");

  if (!mediaId) throw new Error("mediaId inválido");

  const fetchFn = await getFetch();
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(mediaId)}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetchFn(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(`Graph media metadata falhou (${resp.status}): ${JSON.stringify(data)}`);
    }
    // geralmente retorna { url, mime_type, sha256, file_size, id }
    return data || {};
  } finally {
    clearTimeout(t);
  }
}

async function proxyWhatsAppMediaToResponse(mediaId, res, { timeoutMs = 25000 } = {}) {
  const { token } = getWaConfig();
  if (!token) throw new Error("WHATSAPP_TOKEN ausente (não dá pra baixar mídia)");

  const fetchFn = await getFetch();

  // 1) resolve metadata/url
  const meta = await getWhatsAppMediaMetadata(mediaId, { timeoutMs: 12000 });
  const mediaUrl = meta?.url;
  if (!mediaUrl) throw new Error("Graph não retornou url da mídia");

  // 2) baixa binário (url exige Bearer token)
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let resp;
  try {
    resp = await fetchFn(mediaUrl, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal
    });
  } finally {
    clearTimeout(t);
  }

  if (!resp?.ok) {
    const raw = await resp.text().catch(() => "");
    throw new Error(`Download mídia falhou (${resp?.status}): ${raw || "sem detalhes"}`);
  }

  const ct =
    resp.headers?.get?.("content-type") ||
    meta?.mime_type ||
    "application/octet-stream";

  res.setHeader("Content-Type", ct);
  // cache curto: a URL da Meta é temporária
  res.setHeader("Cache-Control", "private, max-age=60");

  // stream
  if (resp.body?.pipe) {
    resp.body.pipe(res);
    return;
  }

  // fallback (caso body não seja stream)
  const buf = await resp.arrayBuffer();
  res.send(Buffer.from(buf));
}

// ======================================================
// Sender (texto) — mantém seu comportamento
// ======================================================
async function sendWhatsAppText(to, body) {
  const { token, phoneNumberId, apiVersion } = getWaConfig();

  if (!token || !phoneNumberId) {
    logger.warn(
      { hasToken: !!token, hasPhoneNumberId: !!phoneNumberId },
      "⚠️ WHATSAPP_TOKEN/PHONE_NUMBER_ID ausentes. Pulando envio."
    );
    return { ok: false, skipped: true };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;
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
      Authorization: `Bearer ${token}`,
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
// ✅ GET /webhook/whatsapp/media/:mediaId
// Proxy para o front renderizar áudio/imagem/sticker/etc
// ===============================
router.get("/media/:mediaId", async (req, res) => {
  try {
    const mediaId = String(req.params.mediaId || "").trim();
    if (!mediaId) return res.status(400).json({ error: "mediaId obrigatório" });

    await proxyWhatsAppMediaToResponse(mediaId, res);
  } catch (err) {
    logger.warn({ err }, "❌ Falha ao servir mídia WhatsApp");
    return res.status(502).json({ error: "Falha ao buscar mídia", details: String(err?.message || err) });
  }
});

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
    const publicBase = getPublicApiBaseUrl(req);

    for (const msg of messages) {
      const waId = msg.from; // telefone do cliente
      if (!waId) continue;

      // casa contato pelo wa_id quando existir
      const contactMatch =
        contacts.find((c) => String(c?.wa_id) === String(waId)) || contacts[0] || null;
      const profileName = contactMatch?.profile?.name || null;

      // ✅ cria/reutiliza conversa via CORE (Modelo A)
      const r = getOrCreateChannelConversation(db, {
        source: "whatsapp",
        peerId: `wa:${waId}`,
        title: profileName || waId,
        waId,
        phone: waId,
        currentMode: "bot"
      });

      if (!r?.ok) {
        logger.warn({ waId, error: r?.error }, "⚠️ Falha ao obter/criar conversa WhatsApp");
        continue;
      }

      const conv = r.conversation;

      const tsIso = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : nowIso();

      const type = String(msg.type || "text").toLowerCase();
      let text = "";
      let payload = undefined;

      // ===============================
      // ✅ Texto
      // ===============================
      if (type === "text") {
        text = msg.text?.body || "";
      }

      // ===============================
      // ✅ Imagem / Vídeo / Documento
      // (salva mediaId + link proxy pro front)
      // ===============================
      if (type === "image") {
        const mediaId = msg.image?.id || null;
        text = msg.image?.caption || "";
        payload = mediaId
          ? {
              mediaId,
              mimeType: msg.image?.mime_type,
              sha256: msg.image?.sha256,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;
        if (!text?.trim()) text = mediaId ? "[imagem]" : "[imagem recebida]";
      }

      if (type === "video") {
        const mediaId = msg.video?.id || null;
        text = msg.video?.caption || "";
        payload = mediaId
          ? {
              mediaId,
              mimeType: msg.video?.mime_type,
              sha256: msg.video?.sha256,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;
        if (!text?.trim()) text = mediaId ? "[vídeo]" : "[vídeo recebido]";
      }

      if (type === "document") {
        const mediaId = msg.document?.id || null;
        const filename = msg.document?.filename || "";
        text = msg.document?.caption || filename || "";
        payload = mediaId
          ? {
              mediaId,
              filename,
              mimeType: msg.document?.mime_type,
              sha256: msg.document?.sha256,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;
        if (!text?.trim()) text = filename ? `[documento] ${filename}` : "[documento]";
      }

      // ===============================
      // ✅ Áudio (voice/audio)
      // ===============================
      if (type === "audio") {
        const mediaId = msg.audio?.id || null;
        payload = mediaId
          ? {
              mediaId,
              mimeType: msg.audio?.mime_type,
              sha256: msg.audio?.sha256,
              voice: !!msg.audio?.voice,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;
        text = mediaId ? "[áudio]" : "🔊 Áudio recebido (sem link de mídia ainda)";
      }

      // ===============================
      // ✅ Figurinhas (sticker)  — IMPORTANTE
      // ===============================
      if (type === "sticker") {
        const mediaId = msg.sticker?.id || null;
        payload = mediaId
          ? {
              mediaId,
              mimeType: msg.sticker?.mime_type,
              sha256: msg.sticker?.sha256,
              animated: !!msg.sticker?.animated,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;
        text = mediaId ? "[figurinha]" : "[figurinha recebida]";
      }

      // ===============================
      // ✅ Localização
      // ===============================
      if (type === "location") {
        const loc = msg.location || {};
        payload = {
          location: {
            latitude: loc.latitude,
            longitude: loc.longitude,
            name: loc.name,
            address: loc.address
          }
        };
        text =
          loc?.name ||
          loc?.address ||
          (loc?.latitude && loc?.longitude
            ? `Localização: lat=${loc.latitude}, long=${loc.longitude}`
            : "[localização]");
      }

      // ✅ persiste inbound via appendMessage() oficial
      appendMessage(db, conv.id, {
        type, // text|image|audio|sticker|location|...
        from: "client",
        direction: "in",
        text,
        payload, // ✅ ADD: front consegue renderizar link/coords
        createdAt: tsIso,
        waMessageId: msg.id,
        channel: "whatsapp",
        source: "whatsapp"
      });

      // ✅ decide bot x humano (mantém sua lógica)
      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      // Só bot em texto (mantido)
      if (decision?.target === "bot" && type === "text") {
        const history = []; // depois você pode montar últimas N msgs via db.messagesByConversation[conv.id]
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
            isBot: true,
            waMessageId: waBotId || undefined,
            channel: "whatsapp",
            source: "whatsapp"
          });

          conv.currentMode = "bot";
          conv.botAttempts = (conv.botAttempts || 0) + 1;
        }
      } else {
        conv.currentMode = "human";
      }
    }

    // ✅ salva 1 vez no final
    saveDB(db);
    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no whatsappRouter");
    next(err);
  }
});

export default router;
