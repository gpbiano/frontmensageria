// backend/src/routes/webhooks/instagramWebhookRouter.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import prismaMod from "../../lib/prisma.js";
import logger from "../../logger.js";

import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";
import { decideRoute } from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v21.0").trim();

const VERIFY_TOKEN = String(
  process.env.INSTAGRAM_VERIFY_TOKEN ||
    process.env.META_VERIFY_TOKEN ||
    process.env.VERIFY_TOKEN ||
    ""
).trim();

// ✅ App Secret correto (o mesmo do app na Meta)
const META_APP_SECRET = String(
  process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || ""
).trim();

const HANDOFF_MESSAGE = String(
  process.env.INSTAGRAM_HANDOFF_MESSAGE ||
    process.env.MESSENGER_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
).trim();

// ===============================
// Helpers
// ===============================
function nowIso() {
  return new Date().toISOString();
}

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

function msgTextFromIGEvent(ev) {
  // IG Webhooks: message.text geralmente
  return safeStr(ev?.message?.text || ev?.message?.body || ev?.text || "");
}

function isValidIncomingTextEvent(ev) {
  const text = msgTextFromIGEvent(ev);
  if (!text) return false;

  // echo do app
  if (ev?.message?.is_echo === true) return false;

  const senderId = safeStr(ev?.sender?.id);
  const recipientId = safeStr(ev?.recipient?.id);
  if (!senderId || !recipientId) return false;
  if (senderId === recipientId) return false;

  return true;
}

function parseBotReplyToText(botReply) {
  if (!botReply) return "";
  if (typeof botReply === "string") return safeStr(botReply);
  if (typeof botReply?.replyText === "string") return safeStr(botReply.replyText);
  if (typeof botReply?.text === "string") return safeStr(botReply.text);
  return safeStr(botReply?.message || "");
}

// ===============================
// ✅ Signature validation (Meta)
// ===============================
function timingSafeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || "").replace(/^sha256=/, ""), "hex");
    const b = Buffer.from(String(bHex || "").replace(/^sha256=/, ""), "hex");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function validateMetaSignature(req) {
  const sig = String(req.headers["x-hub-signature-256"] || "").trim();

  // Se não tem secret, não valida (modo dev)
  if (!META_APP_SECRET) return { ok: true, skipped: true, reason: "no_app_secret" };

  if (!sig) return { ok: false, reason: "missing_signature" };
  if (!req.rawBody) return { ok: false, reason: "missing_raw_body" };

  const digest = crypto.createHmac("sha256", META_APP_SECRET).update(req.rawBody).digest("hex");
  const ok = timingSafeEqualHex(sig, `sha256=${digest}`);

  return ok ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

// ===============================
// Graph send
// ===============================
async function igSendText({ instagramBusinessId, recipientId, pageAccessToken, text }) {
  if (!instagramBusinessId) throw new Error("instagramBusinessId ausente");
  if (!pageAccessToken) throw new Error("pageAccessToken ausente");
  if (!recipientId) throw new Error("recipientId ausente");

  const bodyText = safeStr(text);
  if (!bodyText) return { ok: true, skipped: true };

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
    instagramBusinessId
  )}/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(recipientId) },
      message: { text: bodyText }
    })
  });

  const raw = await resp.text().catch(() => "");
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  return { ok: resp.ok, status: resp.status, json };
}

// ===============================
// ✅ Persist send status into Message.metadata (providerSendOk/providerError/providerMessageId)
// ===============================
async function patchMessageProviderResult(messageId, sendRes, provider = "instagram") {
  if (!messageId) return;

  const ok = sendRes?.ok === true;

  const providerMessageId =
    sendRes?.json?.message_id ||
    sendRes?.json?.messageId ||
    sendRes?.json?.id ||
    null;

  const providerError = ok
    ? null
    : sendRes?.json?.error || sendRes?.json || sendRes?.status || "send_failed";

  try {
    const current = await prisma.message.findUnique({
      where: { id: String(messageId) },
      select: { metadata: true }
    });

    const meta = current?.metadata && typeof current.metadata === "object" ? current.metadata : {};

    await prisma.message.update({
      where: { id: String(messageId) },
      data: {
        status: ok ? "sent" : "failed",
        metadata: {
          ...meta,
          provider,
          providerSendOk: ok,
          providerError,
          providerMessageId,
          sentAt: ok ? nowIso() : null
        }
      }
    });
  } catch (e) {
    logger.warn({ err: String(e), messageId }, "⚠️ IG webhook: falha ao patch provider result na message");
  }
}

// ===============================
// Resolve ChannelConfig
// ===============================
async function resolveChannelByInstagramRecipient(instagramBusinessId) {
  const rid = String(instagramBusinessId || "").trim();
  if (!rid) return null;

  // ✅ prioridade: config.instagramBusinessId
  const byCfg = await prisma.channelConfig.findFirst({
    where: {
      channel: "instagram",
      enabled: true,
      status: "connected",
      config: { path: ["instagramBusinessId"], equals: rid }
    },
    orderBy: { updatedAt: "desc" }
  });
  if (byCfg) return byCfg;

  // fallback: pageId == recipientId (se existir)
  const byPageId = await prisma.channelConfig.findFirst({
    where: { channel: "instagram", enabled: true, status: "connected", pageId: rid },
    orderBy: { updatedAt: "desc" }
  });

  return byPageId || null;
}

// ✅ botEnabled default ON (só OFF se botEnabled === false)
async function isInstagramBotEnabled(tenantId) {
  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId: String(tenantId), channel: "instagram", enabled: true },
      select: { config: true }
    });
    const cfg = row?.config && typeof row.config === "object" ? row.config : {};
    return cfg.botEnabled !== false;
  } catch {
    return true;
  }
}

// ======================================================
// GET /webhook/instagram (verify)
// ======================================================
router.get("/", (req, res) => {
  try {
    const mode = safeStr(req.query["hub.mode"]);
    const token = safeStr(req.query["hub.verify_token"]);
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      logger.info("✅ IG webhook verificado");
      return res.status(200).send(String(challenge || ""));
    }

    logger.warn({ mode, tokenLen: token?.length || 0 }, "❌ IG webhook verify failed");
    return res.status(403).send("forbidden");
  } catch (e) {
    logger.error({ err: String(e?.message || e) }, "❌ IG webhook verify error");
    return res.status(500).send("error");
  }
});

// ======================================================
// POST /webhook/instagram (events)
// ======================================================
router.post("/", async (req, res) => {
  const sig = validateMetaSignature(req);
  if (!sig.ok) {
    logger.warn({ sig }, "❌ IG webhook assinatura inválida");
    return res.sendStatus(403);
  }

  // Meta quer 200 rápido
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [];

    logger.info(
      { object: body.object, entryCount: entries.length, sigSkipped: !!sig.skipped },
      "📥 IG webhook recebido"
    );

    for (const entry of entries) {
      const events = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const ev of events) {
        if (!isValidIncomingTextEvent(ev)) continue;

        const senderId = safeStr(ev?.sender?.id); // user id
        const recipientId = safeStr(ev?.recipient?.id); // instagramBusinessId
        const text = msgTextFromIGEvent(ev);
        const mid = ev?.message?.mid ? String(ev.message.mid) : "";

        logger.info({ senderId, recipientId, mid }, "📩 IG message event");

        // 1) resolve ChannelConfig via recipientId (instagramBusinessId)
        const ch = await resolveChannelByInstagramRecipient(recipientId);
        if (!ch?.tenantId) {
          logger.warn({ recipientId }, "⚠️ IG webhook: tenant não encontrado para recipientId");
          continue;
        }

        const tenantId = String(ch.tenantId);
        const cfg = asJson(ch.config);

        const instagramBusinessId = safeStr(cfg.instagramBusinessId || recipientId);
        const pageAccessToken = safeStr(ch.accessToken);

        if (!pageAccessToken) {
          logger.warn({ tenantId, recipientId }, "⚠️ IG webhook: sem accessToken no ChannelConfig");
          continue;
        }

        // ✅ botEnabled default ON
        const botEnabled = await isInstagramBotEnabled(tenantId);

        // 2) upsert conversa (peerId SEMPRE com prefixo ig:)
        const peerId = `ig:${senderId}`;

        const convRes = await getOrCreateChannelConversation({
          tenantId,
          source: "instagram",
          channel: "instagram",
          peerId,
          title: "Contato Instagram",
          accountId: instagramBusinessId || null,
          meta: { instagramBusinessId, recipientId, pageId: ch.pageId || null }
        });

        if (!convRes?.ok || !convRes?.conversation?.id) {
          logger.warn({ tenantId, recipientId }, "❌ IG webhook: falha ao criar/achar conversa");
          continue;
        }

        const conversation = convRes.conversation;
        const conversationId = String(conversation.id);

        // 3) salva inbound (dedupe via waMessageId)
        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "client",
          direction: "in",
          type: "text",
          text,
          createdAt: nowIso(),
          waMessageId: mid || undefined,
          payload: ev
        });

        // 4) se já está em humano/handoff/inbox → não responde bot
        if (
          String(conversation?.currentMode || "").toLowerCase() === "human" ||
          conversation?.handoffActive === true ||
          conversation?.inboxVisible === true
        ) {
          continue;
        }

        // 5) bot OFF → handoff + promove inbox
        if (!botEnabled) {
          let sendRes = null;
          try {
            sendRes = await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            sendRes = { ok: false, status: 0, json: { error: { message: String(e) } } };
            logger.error(
              { err: String(e), tenantId },
              "❌ IG webhook: handoff (bot disabled) falhou"
            );
          }

          const botMsg = await appendMessage(conversationId, {
            tenantId,
            source: "instagram",
            channel: "instagram",
            from: "bot",
            isBot: true,
            direction: "out",
            type: "text",
            text: HANDOFF_MESSAGE,
            handoff: true,
            createdAt: nowIso(),
            payload: { kind: "handoff_disabled_bot", instagramBusinessId }
          });

          await patchMessageProviderResult(botMsg?.msgRow?.id || botMsg?.msg?.id, sendRes, "instagram");
          continue;
        }

        // 6) rules: bot vs handoff
        const accountSettings = { channel: "instagram", tenantId, instagramBusinessId };

        const route = await decideRoute({
          accountSettings,
          conversation,
          messageText: text
        });

        if (route?.target && route.target !== "bot") {
          let sendRes = null;
          try {
            sendRes = await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            sendRes = { ok: false, status: 0, json: { error: { message: String(e) } } };
            logger.error({ err: String(e), tenantId }, "❌ IG webhook: handoff (route) falhou");
          }

          const botMsg = await appendMessage(conversationId, {
            tenantId,
            source: "instagram",
            channel: "instagram",
            from: "bot",
            isBot: true,
            direction: "out",
            type: "text",
            text: HANDOFF_MESSAGE,
            handoff: true,
            createdAt: nowIso(),
            payload: { kind: "handoff", instagramBusinessId, route }
          });

          await patchMessageProviderResult(botMsg?.msgRow?.id || botMsg?.msg?.id, sendRes, "instagram");
          continue;
        }

        // 7) BOT
        let botText = "";
        try {
          const botReply = await callGenAIBot({
            accountSettings,
            conversation: { ...conversation, id: conversationId },
            messageText: text,
            history: []
          });

          botText = parseBotReplyToText(botReply);
          if (!botText) botText = "Entendi. Pode me dar mais detalhes?";
        } catch (e) {
          logger.error({ err: String(e), tenantId }, "❌ IG webhook: erro botEngine");
          botText = "Desculpe, tive um problema aqui. Pode tentar de novo?";
        }

        let sendRes = null;
        try {
          sendRes = await igSendText({
            instagramBusinessId,
            recipientId: senderId,
            pageAccessToken,
            text: botText
          });
        } catch (e) {
          sendRes = { ok: false, status: 0, json: { error: { message: String(e) } } };
        }

        if (!sendRes.ok) {
          logger.warn(
            { tenantId, status: sendRes.status, meta: sendRes.json?.error || sendRes.json },
            "⚠️ IG webhook: falha no envio Graph"
          );
        }

        const botMsg = await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "bot",
          isBot: true,
          direction: "out",
          type: "text",
          text: botText,
          createdAt: nowIso(),
          payload: { kind: "bot" }
        });

        await patchMessageProviderResult(botMsg?.msgRow?.id || botMsg?.msg?.id, sendRes, "instagram");
      }
    }
  } catch (e) {
    logger.error({ err: String(e?.message || e) }, "❌ IG webhook POST error");
  }
});

export default router;
