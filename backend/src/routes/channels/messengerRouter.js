// backend/src/routes/channels/messengerRouter.js
// ✅ Alinhado com conversations.js (core)
// - botEnabled vem EXCLUSIVAMENTE de ChannelConfig.config.botEnabled (default TRUE)
// - Inbox/Handoff é sempre promovido via appendMessage({ handoff:true })
// - Nunca altera estado direto da conversation
// - peerId padrão: ms:<PSID>

import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

import { decideRoute } from "../../chatbot/rulesEngine.js";
import { callGenAIBot } from "../../chatbot/botEngine.js";
import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

const VERIFY_TOKEN = String(
  process.env.MESSENGER_VERIFY_TOKEN || process.env.VERIFY_TOKEN || ""
).trim();

const META_APP_SECRET = String(process.env.META_APP_SECRET || "").trim();

const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v21.0").trim();

const HANDOFF_MESSAGE = String(
  process.env.MESSENGER_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
).trim();

// ======================================================
// Helpers
// ======================================================
function nowIso() {
  return new Date().toISOString();
}

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function sanitizeAccessToken(raw) {
  let t = safeStr(raw);
  if (!t) return "";
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  t = t.replace(/\s+/g, "");
  const bad = ["null", "undefined", "[objectobject]"];
  if (bad.includes(t.toLowerCase())) return "";
  return t;
}

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
  if (!META_APP_SECRET) return { ok: true, skipped: true };
  if (!sig || !req.rawBody) return { ok: false, reason: "missing_sig_or_raw" };

  const digest = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(req.rawBody)
    .digest("hex");

  return timingSafeEqualHex(sig, `sha256=${digest}`)
    ? { ok: true }
    : { ok: false, reason: "invalid_sig" };
}

function isMessageEvent(m) {
  if (!m) return false;
  if (m.message?.is_echo) return false;
  return !!m.message;
}

function extractText(m) {
  return safeStr(m?.message?.text || "");
}

// ======================================================
// ChannelConfig helpers
// ======================================================
async function getChannelConfigForPageId(pageId, tenantId = null) {
  if (!pageId && !tenantId) return null;

  return prisma.channelConfig.findFirst({
    where: {
      channel: "messenger",
      enabled: true,
      ...(pageId ? { pageId: String(pageId) } : {}),
      ...(tenantId ? { tenantId: String(tenantId) } : {}),
      // se tiver status no schema, ajuda a evitar config velha
      ...(true ? { status: "connected" } : {})
    },
    orderBy: { updatedAt: "desc" }
  });
}

async function resolveTenantIdForWebhook(req, pageId) {
  if (req.tenant?.id) return String(req.tenant.id);

  const cfg = await getChannelConfigForPageId(pageId);
  if (cfg?.tenantId) return String(cfg.tenantId);

  return null;
}

/**
 * botEnabled default TRUE:
 * - só desliga se config.botEnabled === false
 */
async function isMessengerBotEnabled(tenantId) {
  try {
    const row = await prisma.channelConfig.findFirst({
      where: {
        tenantId: String(tenantId),
        channel: "messenger",
        enabled: true,
        ...(true ? { status: "connected" } : {})
      },
      select: { config: true }
    });

    const botEnabled = row?.config?.botEnabled;
    return botEnabled === false ? false : true;
  } catch {
    return true;
  }
}

async function getMsConfig(tenantId, pageId) {
  let cfg = await getChannelConfigForPageId(pageId, tenantId);
  if (!cfg && tenantId) cfg = await getChannelConfigForPageId(null, tenantId);

  return {
    accessToken: sanitizeAccessToken(cfg?.accessToken),
    pageId: safeStr(cfg?.pageId || pageId),
    cfg
  };
}

async function sendMessengerText({ accessToken, recipientId, text }) {
  const token = sanitizeAccessToken(accessToken);
  const body = safeStr(text);

  if (!token || !recipientId || !body) {
    return { ok: false, skipped: true, status: 0, json: { error: "missing_params" } };
  }

  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
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

  return { ok: resp.ok, status: resp.status, json, url };
}

// ======================================================
// GET verify
// ======================================================
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ======================================================
// POST webhook
// ======================================================
router.post("/", async (req, res) => {
  const sig = validateMetaSignature(req);
  if (!sig.ok) {
    logger.warn({ sig }, "❌ Messenger webhook assinatura inválida");
    return res.sendStatus(403);
  }

  res.sendStatus(200);

  const entries = req.body?.entry || [];
  for (const entry of entries) {
    const pageId = safeStr(entry.id);
    const tenantId = await resolveTenantIdForWebhook(req, pageId);
    if (!tenantId) continue;

    const { accessToken } = await getMsConfig(tenantId, pageId);
    const botEnabled = await isMessengerBotEnabled(tenantId);

    if (!accessToken) {
      logger.warn(
        { tenantId, pageId, kind: "ms_token_missing" },
        "❌ Messenger: sem accessToken"
      );
      continue;
    }

    for (const m of entry.messaging || []) {
      if (!isMessageEvent(m)) continue;

      const senderId = safeStr(m.sender?.id);
      const text = extractText(m);

      const convRes = await getOrCreateChannelConversation({
        tenantId,
        source: "messenger",
        channel: "messenger",
        peerId: `ms:${senderId}`,
        title: "Contato"
      });

      if (!convRes?.ok) continue;
      const conv = convRes.conversation;

      // inbound
      await appendMessage(conv.id, {
        from: "client",
        direction: "in",
        source: "messenger",
        channel: "messenger",
        text,
        createdAt: nowIso(),
        payload: m
      });

      if (!text) continue;

      // BOT DESLIGADO → HANDOFF
      if (!botEnabled) {
        const sendRes = await sendMessengerText({
          accessToken,
          recipientId: senderId,
          text: HANDOFF_MESSAGE
        });

        if (!sendRes.ok) {
          logger.warn(
            {
              kind: "handoff_send_failed",
              tenantId,
              pageId,
              senderId,
              status: sendRes.status,
              sendUrl: sendRes.url,
              error: sendRes.json?.error || sendRes.json
            },
            "❌ Messenger handoff: envio falhou"
          );
          continue;
        }

        logger.info(
          { kind: "handoff_disabled_bot", tenantId, senderId, status: sendRes.status, sendUrl: sendRes.url },
          "✅ Messenger send ok"
        );

        await appendMessage(conv.id, {
          from: "bot",
          isBot: true,
          direction: "out",
          source: "messenger",
          channel: "messenger",
          text: HANDOFF_MESSAGE,
          handoff: true,
          createdAt: nowIso(),
          payload: { kind: "handoff_disabled_bot", send: sendRes }
        });

        continue;
      }

      const decision = await decideRoute({
        accountSettings: { tenantId, channel: "messenger", enabled: true },
        conversation: conv,
        messageText: text
      });

      logger.info(
        { kind: "route_decision", tenantId, senderId, pageId, decision },
        "🤖 Messenger decideRoute"
      );

      // HANDOFF (rulesEngine)
      if (decision?.target && decision.target !== "bot") {
        const sendRes = await sendMessengerText({
          accessToken,
          recipientId: senderId,
          text: HANDOFF_MESSAGE
        });

        if (!sendRes.ok) {
          logger.warn(
            {
              kind: "handoff_send_failed",
              tenantId,
              pageId,
              senderId,
              status: sendRes.status,
              sendUrl: sendRes.url,
              error: sendRes.json?.error || sendRes.json,
              decision
            },
            "❌ Messenger handoff: envio falhou"
          );
          continue;
        }

        logger.info(
          { kind: "handoff", tenantId, senderId, status: sendRes.status, sendUrl: sendRes.url },
          "✅ Messenger send ok"
        );

        await appendMessage(conv.id, {
          from: "bot",
          isBot: true,
          direction: "out",
          source: "messenger",
          channel: "messenger",
          text: HANDOFF_MESSAGE,
          handoff: true,
          createdAt: nowIso(),
          payload: { kind: "handoff", decision, send: sendRes }
        });

        continue;
      }

      // BOT
      let botText = "";
      try {
        botText = safeStr(
          await callGenAIBot({
            accountSettings: { tenantId, channel: "messenger" },
            conversation: conv,
            messageText: text
          })
        );
      } catch (e) {
        logger.warn({ err: String(e), tenantId, senderId }, "⚠️ Messenger botEngine falhou");
      }

      if (!botText) botText = "Entendi. Pode me dar mais detalhes?";

      const sendRes = await sendMessengerText({
        accessToken,
        recipientId: senderId,
        text: botText
      });

      if (!sendRes.ok) {
        logger.warn(
          {
            kind: "bot_send_failed",
            tenantId,
            pageId,
            senderId,
            status: sendRes.status,
            sendUrl: sendRes.url,
            error: sendRes.json?.error || sendRes.json
          },
          "❌ Messenger bot: envio falhou"
        );
        continue;
      }

      logger.info(
        { kind: "bot", tenantId, senderId, status: sendRes.status, sendUrl: sendRes.url },
        "✅ Messenger send ok"
      );

      await appendMessage(conv.id, {
        from: "bot",
        isBot: true,
        direction: "out",
        source: "messenger",
        channel: "messenger",
        text: botText,
        createdAt: nowIso(),
        payload: { kind: "bot", send: sendRes }
      });
    }
  }
});

export default router;
