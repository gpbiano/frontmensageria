// backend/src/routes/channels/whatsappRouter.js
import express from "express";
import crypto from "crypto";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

import { getChatbotSettingsForAccount, decideRoute } from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

// ✅ Prisma-first conversations core
import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.WHATSAPP_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

const HANDOFF_MESSAGE = String(
  process.env.WHATSAPP_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
).trim();

const META_APP_SECRET = String(process.env.META_APP_SECRET || "").trim(); // assinatura do webhook (opcional)
const DEFAULT_API_VERSION = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();

function nowIso() {
  return new Date().toISOString();
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

// ✅ Meta manda outros eventos (statuses, etc). Só queremos messages.
function hasInboundMessages(value) {
  return Array.isArray(value?.messages) && value.messages.length > 0;
}

function getPublicApiBaseUrl(req) {
  const envBase = String(process.env.PUBLIC_API_BASE_URL || "")
    .trim()
    .replace(/\/+$/, "");
  if (envBase) return envBase;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http");
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost");
  return `${proto}://${host}`;
}

function safeTenantIdFromReq(req) {
  const t1 = req?.tenant?.id ? String(req.tenant.id).trim() : "";
  if (t1) return t1;

  const t2 = req.headers["x-tenant-id"] ? String(req.headers["x-tenant-id"]).trim() : "";
  if (t2) return t2;

  const t3 = String(process.env.WHATSAPP_DEFAULT_TENANT_ID || "").trim();
  if (t3) return t3;

  return "";
}

async function resolveTenantIdForWebhook(req) {
  const direct = safeTenantIdFromReq(req);
  if (direct) return direct;

  // Fallback final: pega o último ChannelConfig do WhatsApp enabled
  const cfg = await prisma.channelConfig.findFirst({
    where: { channel: "whatsapp", enabled: true },
    orderBy: { updatedAt: "desc" },
    select: { tenantId: true }
  });

  return cfg?.tenantId ? String(cfg.tenantId) : "";
}

// ======================================================
// ✅ Multi-tenant WA config (token/phoneNumberId por tenant)
// ======================================================
async function getWaConfigForTenant(tenantId) {
  // 1) tenta buscar do banco (Embedded Signup)
  if (tenantId) {
    const row = await prisma.channelConfig.findUnique({
      where: { tenantId_channel: { tenantId: String(tenantId), channel: "whatsapp" } },
      select: { enabled: true, status: true, config: true }
    });

    const cfg = row?.config || {};
    const token = String(cfg.accessToken || "").trim();
    const phoneNumberId = String(cfg.phoneNumberId || "").trim();
    const apiVersion =
      String(cfg.apiVersion || DEFAULT_API_VERSION).trim() || DEFAULT_API_VERSION;

    if (token && phoneNumberId) {
      return { ok: true, source: "db", token, phoneNumberId, apiVersion };
    }
  }

  // 2) fallback ENV (legado)
  const envToken = String(process.env.WHATSAPP_TOKEN || "").trim();
  const envPhoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();

  if (envToken && envPhoneNumberId) {
    return {
      ok: true,
      source: "env",
      token: envToken,
      phoneNumberId: envPhoneNumberId,
      apiVersion: DEFAULT_API_VERSION
    };
  }

  return {
    ok: false,
    source: "none",
    token: "",
    phoneNumberId: "",
    apiVersion: DEFAULT_API_VERSION
  };
}

function hasSignatureHeader(req) {
  const sig = String(req.headers["x-hub-signature-256"] || "").trim();
  return sig.startsWith("sha256=");
}

function verifyWebhookSignature(req) {
  // Se não houver secret, não bloqueia (mas loga)
  if (!META_APP_SECRET) return { ok: true, skipped: true };

  // Se Meta não enviar assinatura, não bloqueia mas loga
  if (!hasSignatureHeader(req)) return { ok: true, skipped: true };

  const signatureHeader = String(req.headers["x-hub-signature-256"] || "").trim();
  const expectedPrefix = "sha256=";

  // Precisa do raw body (você deve configurar o express para salvar rawBody no webhook)
  const rawBody =
    req.rawBody ||
    req.bodyRaw ||
    (typeof req.body === "string" ? req.body : null) ||
    null;

  if (!rawBody) return { ok: false, error: "missing_raw_body_for_signature" };

  const hmac = crypto.createHmac("sha256", META_APP_SECRET).update(rawBody).digest("hex");
  const expected = `${expectedPrefix}${hmac}`;

  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  const sameLen = a.length === b.length;
  const equal = sameLen && crypto.timingSafeEqual(a, b);

  return equal ? { ok: true } : { ok: false, error: "invalid_signature" };
}

// ======================================================
// ✅ SEND (Graph API) — envia pro WhatsApp (tenant aware)
// ======================================================
async function sendWhatsAppText({ tenantId, to, body, timeoutMs = 12000 }) {
  const wa = await getWaConfigForTenant(tenantId);

  if (!wa.ok || !wa.token || !wa.phoneNumberId) {
    logger.error(
      {
        tenantId,
        source: wa.source,
        hasToken: !!wa.token,
        hasPhoneNumberId: !!wa.phoneNumberId
      },
      "❌ WA token/phoneNumberId ausentes (DB/ENV). Não dá pra enviar."
    );
    return { ok: false, error: "missing_whatsapp_config" };
  }

  const toDigits = onlyDigits(to);
  if (!toDigits) return { ok: false, error: "missing_to" };

  const cleanBody = String(body || "").trim();
  if (!cleanBody) return { ok: false, error: "missing_body" };

  const url = `https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: toDigits,
    type: "text",
    text: { preview_url: false, body: cleanBody }
  };

  const fetchFn = await getFetch();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${wa.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const raw = await resp.text().catch(() => "");
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      data = {};
    }

    if (!resp.ok) {
      logger.error({ tenantId, status: resp.status, data, raw }, "❌ WhatsApp send falhou");
      return { ok: false, status: resp.status, data, raw };
    }

    logger.info(
      { tenantId, waMessageId: data?.messages?.[0]?.id, to: toDigits, source: wa.source },
      "✅ WhatsApp send OK"
    );
    return { ok: true, data };
  } catch (err) {
    logger.error({ tenantId, err }, "❌ WhatsApp send exception");
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

// ======================================================
// GET /webhook/whatsapp (verificação Meta)
// ======================================================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = String(req.query["hub.verify_token"] || "").trim();
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Webhook WhatsApp verificado");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ======================================================
// GET /webhook/whatsapp/media/:mediaId (proxy do download)
// ======================================================
router.get("/media/:mediaId", async (req, res) => {
  try {
    const mediaId = String(req.params.mediaId || "").trim();
    if (!mediaId) return res.status(400).json({ error: "missing_media_id" });

    const tenantId = await resolveTenantIdForWebhook(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const wa = await getWaConfigForTenant(tenantId);
    if (!wa.ok || !wa.token) return res.status(400).json({ error: "missing_whatsapp_config" });

    const fetchFn = await getFetch();

    // 1) pega URL do media
    const metaResp = await fetchFn(`https://graph.facebook.com/${wa.apiVersion}/${mediaId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${wa.token}` }
    });

    const metaRaw = await metaResp.text().catch(() => "");
    let meta = {};
    try {
      meta = metaRaw ? JSON.parse(metaRaw) : {};
    } catch {
      meta = {};
    }

    if (!metaResp.ok || !meta?.url) {
      logger.error({ tenantId, status: metaResp.status, meta }, "❌ Falha ao buscar URL da mídia");
      return res.status(502).json({ error: "media_meta_failed", meta });
    }

    // 2) baixa binário
    const binResp = await fetchFn(meta.url, {
      method: "GET",
      headers: { Authorization: `Bearer ${wa.token}` }
    });

    if (!binResp.ok) {
      const raw = await binResp.text().catch(() => "");
      logger.error({ tenantId, status: binResp.status, raw }, "❌ Falha ao baixar mídia");
      return res.status(502).json({ error: "media_download_failed", status: binResp.status });
    }

    const ct = binResp.headers.get("content-type") || meta?.mime_type || "application/octet-stream";
    res.setHeader("Content-Type", ct);

    const buf = Buffer.from(await binResp.arrayBuffer());
    return res.status(200).send(buf);
  } catch (err) {
    logger.error({ err }, "❌ Erro /media/:mediaId");
    return res.status(500).json({ error: "internal_error" });
  }
});

// ======================================================
// POST /webhook/whatsapp (mensagens) — PRISMA ONLY
// ======================================================
router.post("/", async (req, res, next) => {
  try {
    const sig = verifyWebhookSignature(req);
    if (!sig.ok) {
      logger.warn({ err: sig.error }, "⚠️ Webhook signature inválida");
      return res.sendStatus(403);
    }

    const body = req.body;

    if (body?.object !== "whatsapp_business_account") {
      return res.sendStatus(200);
    }

    const value = body.entry?.[0]?.changes?.[0]?.value;

    // ✅ Ignora callbacks que não são mensagens (ex: statuses)
    if (!hasInboundMessages(value)) return res.sendStatus(200);

    const messages = value.messages;
    const contacts = Array.isArray(value?.contacts) ? value.contacts : [];

    const publicBase = getPublicApiBaseUrl(req);

    // ✅ resolve tenantId pro webhook (público)
    const tenantId = await resolveTenantIdForWebhook(req);
    if (!tenantId) {
      logger.error(
        { hint: "Defina WHATSAPP_DEFAULT_TENANT_ID ou habilite ChannelConfig whatsapp" },
        "❌ TenantId não resolvido para webhook WhatsApp"
      );
      return res.status(400).json({
        error: "Tenant não resolvido",
        hint: "Defina WHATSAPP_DEFAULT_TENANT_ID ou habilite ChannelConfig(channel=whatsapp, enabled=true)"
      });
    }

    // loga se não tiver config pra enviar (mas ainda persiste inbound)
    const waCfg = await getWaConfigForTenant(tenantId);
    if (!waCfg.ok) {
      logger.warn(
        { tenantId },
        "⚠️ WhatsApp não configurado (DB/ENV). Vai persistir inbound, mas envios podem falhar."
      );
    }

    for (const msg of messages) {
      const waId = msg.from;
      if (!waId) continue;

      // ✅ Anti-loop (defensivo)
      if (msg.from === value?.metadata?.display_phone_number) continue;

      const contactMatch =
        contacts.find((c) => String(c?.wa_id) === String(waId)) || contacts[0] || null;

      const profileName = contactMatch?.profile?.name || null;

      // ✅ Prisma-first: create/reuse conversation OPEN do mesmo contact/channel
      const r = await getOrCreateChannelConversation({
        tenantId,
        source: "whatsapp",
        peerId: `wa:${waId}`,
        title: profileName || waId,
        waId,
        phone: waId,
        currentMode: "bot"
      });

      if (!r?.ok) continue;

      const conv = r.conversation;

      const tsIso = msg.timestamp
        ? new Date(Number(msg.timestamp) * 1000).toISOString()
        : nowIso();

      const type = String(msg.type || "text").toLowerCase();
      let text = "";
      let payload = undefined;

      // =====================
      // TEXT
      // =====================
      if (type === "text") {
        text = msg.text?.body || "";
      }

      // =====================
      // MEDIA
      // =====================
      if (["image", "video", "audio", "document", "sticker"].includes(type)) {
        const media = msg[type] || {};
        const mediaId = media.id || null;

        payload = mediaId
          ? {
              mediaId,
              mimeType: media.mime_type,
              sha256: media.sha256,
              filename: media.filename,
              animated: media.animated,
              voice: media.voice,
              link: `${publicBase}/webhook/whatsapp/media/${mediaId}`
            }
          : undefined;

        text = media.caption || media.filename || `[${type === "sticker" ? "figurinha" : type}]`;
      }

      // =====================
      // LOCATION
      // =====================
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
          loc.name ||
          loc.address ||
          (loc.latitude != null && loc.longitude != null
            ? `Localização: ${loc.latitude}, ${loc.longitude}`
            : "[localização]");
      }

      // =====================
      // PERSISTE INBOUND (PRISMA)
      // =====================
      await appendMessage(conv.id, {
        type,
        from: "client",
        direction: "in",
        text,
        payload,
        createdAt: tsIso,
        waMessageId: msg.id,
        channel: "whatsapp",
        source: "whatsapp",
        tenantId
      });

      // ==================================================
      // 🔒 Se já está em handoff/humano -> NÃO responde bot
      // ==================================================
      const isAlreadyHandoff =
        conv?.handoffActive === true ||
        String(conv?.currentMode || "").toLowerCase() === "human" ||
        conv?.inboxVisible === true;

      if (isAlreadyHandoff) continue;

      // ==================================================
      // BOT DECISION (só decide com texto)
      // ==================================================
      if (type !== "text") continue;

      const accountId = conv.accountId || "default";
      const accountSettings = getChatbotSettingsForAccount(accountId);

      const decision = decideRoute({
        accountSettings,
        conversation: conv,
        messageText: text
      });

      const target = String(decision?.target || "bot").toLowerCase();
      const shouldBotReply = target === "bot";

      // ==================================================
      // ✅ HANDOFF (vira humano -> aparece no painel)
      // ==================================================
      if (!shouldBotReply) {
        const sent = await sendWhatsAppText({ tenantId, to: waId, body: HANDOFF_MESSAGE });

        const waBotId =
          sent?.data?.messages?.[0]?.id || sent?.data?.message_id || sent?.data?.id || null;

        await appendMessage(conv.id, {
          type: "text",
          from: "bot",
          direction: "out",
          text: HANDOFF_MESSAGE,
          createdAt: nowIso(),
          isBot: true,
          handoff: true,
          waMessageId: waBotId || undefined,
          delivery: sent?.ok
            ? { status: "sent", at: nowIso() }
            : {
                status: "failed",
                error:
                  sent?.raw ||
                  sent?.error ||
                  (sent?.data ? JSON.stringify(sent.data) : "handoff_send_failed"),
                at: nowIso()
              },
          channel: "whatsapp",
          source: "whatsapp",
          tenantId
        });

        continue;
      }

      // ==================================================
      // ✅ BOT REPLY (texto)
      // ==================================================
      const botResult = await callGenAIBot({
        accountSettings,
        conversation: conv,
        messageText: text,
        history: []
      });

      const reply = String(botResult?.replyText || "").trim();
      if (!reply) continue;

      const sent = await sendWhatsAppText({ tenantId, to: waId, body: reply });

      const waBotId =
        sent?.data?.messages?.[0]?.id || sent?.data?.message_id || sent?.data?.id || null;

      await appendMessage(conv.id, {
        type: "text",
        from: "bot",
        direction: "out",
        text: reply,
        createdAt: nowIso(),
        isBot: true,
        waMessageId: waBotId || undefined,
        delivery: sent?.ok
          ? { status: "sent", at: nowIso() }
          : {
              status: "failed",
              error:
                sent?.raw ||
                sent?.error ||
                (sent?.data ? JSON.stringify(sent.data) : "send_failed"),
              at: nowIso()
            },
        channel: "whatsapp",
        source: "whatsapp",
        tenantId
      });
    }

    return res.sendStatus(200);
  } catch (err) {
    logger.error({ err }, "❌ Erro no webhook WhatsApp");
    next(err);
  }
});

export default router;
