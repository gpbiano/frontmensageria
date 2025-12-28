// backend/src/routes/channels/messengerRouter.js
// ✅ Alinhado com conversations.js (core)
// - botEnabled vem EXCLUSIVAMENTE de ChannelConfig.config.botEnabled
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
    return row?.config?.botEnabled === true;
  } catch {
    return false;
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
  if (!accessToken || !recipientId || !text) return;

  await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_type: "RESPONSE",
        recipient: { id: recipientId },
        message: { text }
      })
    }
  );
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

      // BOT DESLIGADO → HANDOFF
      if (!botEnabled) {
        await sendMessengerText({
          accessToken,
          recipientId: senderId,
          text: HANDOFF_MESSAGE
        });

        await appendMessage(conv.id, {
          from: "bot",
          isBot: true,
          direction: "out",
          source: "messenger",
          channel: "messenger",
          text: HANDOFF_MESSAGE,
          handoff: true,
          createdAt: nowIso(),
          payload: { kind: "handoff_disabled_bot" }
        });
        continue;
      }

      if (!text) continue;

      const decision = await decideRoute({
        accountSettings: { tenantId, channel: "messenger" },
        conversation: conv,
        messageText: text
      });

      // HANDOFF (rulesEngine)
      if (decision?.target && decision.target !== "bot") {
        await sendMessengerText({
          accessToken,
          recipientId: senderId,
          text: HANDOFF_MESSAGE
        });

        await appendMessage(conv.id, {
          from: "bot",
          isBot: true,
          direction: "out",
          source: "messenger",
          channel: "messenger",
          text: HANDOFF_MESSAGE,
          handoff: true,
          createdAt: nowIso(),
          payload: { kind: "handoff" }
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
      } catch {}

      if (!botText) botText = "Entendi. Pode me dar mais detalhes?";

      await sendMessengerText({
        accessToken,
        recipientId: senderId,
        text: botText
      });

      await appendMessage(conv.id, {
        from: "bot",
        isBot: true,
        direction: "out",
        source: "messenger",
        channel: "messenger",
        text: botText,
        createdAt: nowIso(),
        payload: { kind: "bot" }
      });
    }
  }
});

export default router;
