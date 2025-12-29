// backend/src/routes/channels/messengerRouter.js
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

function parseBotReplyToText(botReply) {
  if (!botReply) return "";
  if (typeof botReply === "string") return safeStr(botReply);
  if (typeof botReply?.replyText === "string") return safeStr(botReply.replyText);
  if (typeof botReply?.text === "string") return safeStr(botReply.text);
  return safeStr(botReply?.message || "");
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
  if (!sig || !req.rawBody) return { ok: false };

  const digest = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(req.rawBody)
    .digest("hex");

  return timingSafeEqualHex(sig, `sha256=${digest}`) ? { ok: true } : { ok: false };
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
async function isMessengerBotEnabled(tenantId) {
  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId, channel: "messenger", enabled: true },
      select: { config: true }
    });
    const cfg = row?.config && typeof row.config === "object" ? row.config : {};
    // ✅ default TRUE (só desliga se false)
    return cfg.botEnabled !== false;
  } catch {
    return true;
  }
}

async function getChannelConfigForPageId(pageId) {
  if (!pageId) return null;

  return prisma.channelConfig.findFirst({
    where: { channel: "messenger", enabled: true, pageId },
    orderBy: { updatedAt: "desc" }
  });
}

async function resolveTenantIdForWebhook(req, pageId) {
  if (req.tenant?.id) return String(req.tenant.id);

  const cfg = await getChannelConfigForPageId(pageId);
  if (cfg?.tenantId) return String(cfg.tenantId);

  return null;
}

async function getMsConfig(tenantId, pageId) {
  let cfg = await getChannelConfigForPageId(pageId);
  if (!cfg && tenantId) {
    cfg = await prisma.channelConfig.findFirst({
      where: { tenantId, channel: "messenger", enabled: true }
    });
  }

  return {
    accessToken: safeStr(cfg?.accessToken),
    pageId: safeStr(cfg?.pageId || pageId)
  };
}

async function sendMessengerText({ accessToken, recipientId, text }) {
  if (!accessToken || !recipientId || !text) return { ok: false, skipped: true };

  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(
    accessToken
  )}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_type: "RESPONSE",
      recipient: { id: recipientId },
      message: { text }
    })
  });

  const raw = await resp.text().catch(() => "");
  let json = {};
  try {
    json = raw ? JSON.parse(raw) : {};
  } catch {
    json = { raw };
  }

  return { ok: resp.ok, status: resp.status, json, url };
}

// ✅ trava conversa em humano depois do handoff
async function activateHandoff(conversationId) {
  try {
    await prisma.conversation.update({
      where: { id: String(conversationId) },
      data: {
        currentMode: "human",
        handoffActive: true,
        inboxVisible: true,
        updatedAt: new Date()
      }
    });
  } catch (e) {
    logger.warn({ err: String(e), conversationId }, "⚠️ Messenger: falha ao ativar handoff no DB");
  }
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
  if (!validateMetaSignature(req).ok) return res.sendStatus(403);
  res.sendStatus(200);

  const entries = req.body?.entry || [];
  for (const entry of entries) {
    const pageId = safeStr(entry.id);
    const tenantId = await resolveTenantIdForWebhook(req, pageId);
    if (!tenantId) continue;

    const { accessToken } = await getMsConfig(tenantId, pageId);
    const botEnabled = await isMessengerBotEnabled(tenantId);

    for (const m of entry.messaging || []) {
      if (!isMessageEvent(m)) continue;

      const senderId = safeStr(m.sender?.id);
      const text = extractText(m);

      const convRes = await getOrCreateChannelConversation({
        tenantId,
        source: "messenger",
        channel: "messenger",
        peerId: `ms:${senderId}`,
        title: "Contato",
        meta: { pageId }
      });

      if (!convRes?.ok) continue;
      const conv = convRes.conversation;

      await appendMessage(conv.id, {
        tenantId,
        from: "client",
        direction: "in",
        source: "messenger",
        channel: "messenger",
        text,
        createdAt: nowIso(),
        payload: m
      });

      // ✅ se já está em humano/handoff → não responde bot
      if (
        String(conv?.currentMode || "").toLowerCase() === "human" ||
        conv?.handoffActive === true ||
        conv?.inboxVisible === true
      ) {
        continue;
      }

      // BOT DESLIGADO → HANDOFF
      if (!botEnabled) {
        const sendRes = await sendMessengerText({
          accessToken,
          recipientId: senderId,
          text: HANDOFF_MESSAGE
        });

        if (sendRes?.ok) await activateHandoff(conv.id);

        await appendMessage(conv.id, {
          tenantId,
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

      if (!text) continue;

      const decision = decideRoute({
        // ✅ agora o rulesEngine defaulta enabled=true e keywords do default
        accountSettings: { tenantId, channel: "messenger" },
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

        if (sendRes?.ok) await activateHandoff(conv.id);

        await appendMessage(conv.id, {
          tenantId,
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
        const botReply = await callGenAIBot({
          accountSettings: { tenantId, channel: "messenger" },
          conversation: conv,
          messageText: text,
          history: []
        });
        botText = parseBotReplyToText(botReply);
      } catch {}

      if (!botText) botText = "Entendi. Pode me dar mais detalhes?";

      const sendRes = await sendMessengerText({
        accessToken,
        recipientId: senderId,
        text: botText
      });

      logger.info(
        { kind: "bot", tenantId, senderId, status: sendRes?.status, sendUrl: sendRes?.url },
        "✅ Messenger send"
      );

      await appendMessage(conv.id, {
        tenantId,
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
