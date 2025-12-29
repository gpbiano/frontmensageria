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

// ✅ App Secret do MESMO APP que configurou o Webhook na Meta
// (suporta múltiplos: "s1,s2")
const META_APP_SECRET_RAW = String(
  process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET || ""
).trim();

const META_VERIFY_SIGNATURE =
  String(process.env.META_VERIFY_SIGNATURE || "true").toLowerCase() !== "false";

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
  return safeStr(ev?.message?.text || ev?.message?.body || ev?.text || "");
}
function isValidIncomingTextEvent(ev) {
  const text = msgTextFromIGEvent(ev);
  if (!text) return false;
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
// ✅ Signature validation (Meta) — usando RAW (Buffer)
// ===============================
function getSignatureHeader(req) {
  const s256 = String(req.headers["x-hub-signature-256"] || "").trim();
  const s1 = String(req.headers["x-hub-signature"] || "").trim();
  return s256 || s1;
}
function normalizeSigHex(sig) {
  return String(sig || "").trim().replace(/^sha256=/i, "");
}
function computeSha256Hex(secret, rawBodyBuf) {
  return crypto.createHmac("sha256", secret).update(rawBodyBuf).digest("hex");
}
function timingSafeEqualHex(aHex, bHex) {
  try {
    const a = Buffer.from(String(aHex || ""), "hex");
    const b = Buffer.from(String(bHex || ""), "hex");
    if (!a.length || !b.length) return false;
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function validateMetaSignatureRaw(req) {
  if (!META_VERIFY_SIGNATURE) return { ok: true, skipped: true, reason: "META_VERIFY_SIGNATURE=false" };

  const sigHeader = getSignatureHeader(req);
  const secrets = META_APP_SECRET_RAW.split(",").map((s) => s.trim()).filter(Boolean);

  const hasSecret = secrets.length > 0;
  const raw = req.body; // ✅ aqui é Buffer (porque no index usamos express.raw)
  const hasRawBody = Buffer.isBuffer(raw);
  const rawLen = hasRawBody ? raw.length : 0;

  if (!hasSecret) return { ok: true, skipped: true, reason: "no_app_secret", hasSecret, hasRawBody, rawLen };
  if (!sigHeader) return { ok: false, reason: "missing_signature", hasSecret, hasRawBody, rawLen };
  if (!hasRawBody) return { ok: false, reason: "missing_raw_body", hasSecret, hasRawBody, rawLen };

  const gotHex = normalizeSigHex(sigHeader);

  for (const secret of secrets) {
    const expectedHex = computeSha256Hex(secret, raw);
    if (timingSafeEqualHex(gotHex, expectedHex)) return { ok: true, hasSecret, hasRawBody, rawLen };
  }

  // debug seguro
  const expected0 = computeSha256Hex(secrets[0], raw);
  return {
    ok: false,
    reason: "invalid_signature",
    hasSecret,
    hasRawBody,
    rawLen,
    sigPrefix: gotHex.slice(0, 12),
    digestPrefix: expected0.slice(0, 12)
  };
}

// ===============================
// Graph send
// ===============================
async function igSendText({ instagramBusinessId, recipientId, pageAccessToken, text }) {
  if (!instagramBusinessId) throw new Error("instagramBusinessId ausente");
  if (!pageAccessToken) throw new Error("pageAccessToken ausente");
  if (!recipientId) throw new Error("recipientId ausente");
  const body = safeStr(text);
  if (!body) return { ok: true, skipped: true };

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
    instagramBusinessId
  )}/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: String(recipientId) },
      message: { text: body }
    })
  });

  const rawText = await resp.text().catch(() => "");
  let json = {};
  try {
    json = rawText ? JSON.parse(rawText) : {};
  } catch {
    json = { raw: rawText };
  }
  return { ok: resp.ok, status: resp.status, json };
}

// ===============================
// Resolve ChannelConfig
// ===============================
async function resolveChannelByInstagramRecipient(instagramBusinessId) {
  const rid = String(instagramBusinessId || "").trim();
  if (!rid) return null;

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
    return res.status(403).send("forbidden");
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook verify error");
    return res.status(500).send("error");
  }
});

// ======================================================
// POST /webhook/instagram (events) — RAW + JSON manual
// ======================================================
router.post("/", async (req, res) => {
  const sig = validateMetaSignatureRaw(req);
  if (!sig.ok) {
    logger.warn({ sig }, "❌ IG webhook assinatura inválida");
    return res.sendStatus(403);
  }

  // Meta quer 200 rápido
  res.sendStatus(200);

  let body = {};
  try {
    body = req.body && Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString("utf8")) : {};
  } catch (e) {
    logger.error({ err: String(e), rawLen: Buffer.isBuffer(req.body) ? req.body.length : 0 }, "❌ IG webhook JSON parse failed");
    return;
  }

  try {
    const entries = Array.isArray(body.entry) ? body.entry : [];

    logger.info(
      { object: body.object, entryCount: entries.length, sigSkipped: !!sig.skipped },
      "📥 IG webhook recebido"
    );

    for (const entry of entries) {
      const events = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const ev of events) {
        if (!isValidIncomingTextEvent(ev)) continue;

        const senderId = safeStr(ev?.sender?.id);
        const recipientId = safeStr(ev?.recipient?.id);
        const text = msgTextFromIGEvent(ev);
        const mid = ev?.message?.mid ? String(ev.message.mid) : "";

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

        const botEnabled = await isInstagramBotEnabled(tenantId);

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

        // inbound
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

        // se já está em humano/handoff/inbox → não responde bot
        if (
          String(conversation?.currentMode || "").toLowerCase() === "human" ||
          conversation?.handoffActive === true ||
          conversation?.inboxVisible === true
        ) {
          continue;
        }

        // bot OFF → handoff + promove inbox
        if (!botEnabled) {
          try {
            await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ IG webhook: handoff (bot disabled) falhou");
          }

          await appendMessage(conversationId, {
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

          continue;
        }

        // rules: bot vs handoff
        const accountSettings = { channel: "instagram", tenantId, instagramBusinessId };

        const route = await decideRoute({
          accountSettings,
          conversation,
          messageText: text
        });

        if (route?.target && route.target !== "bot") {
          try {
            await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ IG webhook: handoff (route) falhou");
          }

          await appendMessage(conversationId, {
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

          continue;
        }

        // BOT
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

        const sendRes = await igSendText({
          instagramBusinessId,
          recipientId: senderId,
          pageAccessToken,
          text: botText
        });

        if (!sendRes.ok) {
          logger.warn(
            { tenantId, status: sendRes.status, meta: sendRes.json?.error || sendRes.json },
            "⚠️ IG webhook: falha no envio Graph"
          );
        }

        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "bot",
          isBot: true,
          direction: "out",
          type: "text",
          text: botText,
          createdAt: nowIso(),
          payload: { kind: "bot", sendOk: sendRes.ok, sendStatus: sendRes.status }
        });
      }
    }
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook POST error");
  }
});

export default router;
