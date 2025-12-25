// backend/src/routes/webhooks/instagramWebhookRouter.js
import express from "express";
import fetch from "node-fetch";
import prismaMod from "../../lib/prisma.js";
import logger from "../../logger.js";

import { getOrCreateChannelConversation, appendMessage } from "../conversations.js";
import { getChatbotSettingsForAccount, decideRoute } from "../../chatbot/rulesEngine.js";
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

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function msgTextFromIGEvent(ev) {
  return safeStr(ev?.message?.text || ev?.message?.body || ev?.text || "");
}

async function igSendText({ instagramBusinessId, recipientId, pageAccessToken, text }) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
    instagramBusinessId
  )}/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
  return { ok: resp.ok, status: resp.status, json };
}

async function resolveTenantByInstagramRecipient(instagramBusinessId) {
  return prisma.channelConfig.findFirst({
    where: {
      channel: "instagram",
      enabled: true,
      status: "connected",
      config: { path: ["instagramBusinessId"], equals: String(instagramBusinessId) }
    },
    orderBy: { updatedAt: "desc" }
  });
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
      return res.status(200).send(String(challenge || ""));
    }
    return res.status(403).send("forbidden");
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook verify error");
    return res.status(500).send("error");
  }
});

// ======================================================
// POST /webhook/instagram (events)
// ======================================================
router.post("/", async (req, res) => {
  // responde rápido pra Meta
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      const events = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const ev of events) {
        const senderId = safeStr(ev?.sender?.id); // user
        const recipientId = safeStr(ev?.recipient?.id); // IG business
        const text = msgTextFromIGEvent(ev);

        if (!senderId || !recipientId || !text) continue;

        const ch = await resolveTenantByInstagramRecipient(recipientId);
        if (!ch?.tenantId) {
          logger.warn({ recipientId }, "⚠️ IG webhook: tenant não encontrado para recipientId");
          continue;
        }

        const tenantId = String(ch.tenantId);

        const convRes = await getOrCreateChannelConversation({
          tenantId,
          source: "instagram",
          peerId: senderId,
          title: "Contato Instagram"
        });

        if (!convRes?.ok || !convRes?.conversation?.id) continue;

        const conversationId = String(convRes.conversation.id);

        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "client",
          direction: "in",
          type: "text",
          text,
          createdAt: new Date().toISOString(),
          waMessageId: ev?.message?.mid ? String(ev.message.mid) : undefined,
          payload: ev
        });

        const botSettings = await getChatbotSettingsForAccount({
          tenantId,
          channel: "instagram",
          accountId: recipientId
        });

        const route = decideRoute({
          channel: "instagram",
          text,
          settings: botSettings
        });

        if (route?.mode !== "bot") continue;

        const botReply = await callGenAIBot({
          tenantId,
          channel: "instagram",
          conversationId,
          text,
          settings: botSettings
        });

        const botText = safeStr(botReply?.text || botReply?.message || botReply || "");
        if (!botText) continue;

        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "bot",
          direction: "out",
          type: "text",
          text: botText,
          createdAt: new Date().toISOString()
        });

        const pageAccessToken = safeStr(ch.accessToken);
        const instagramBusinessId = safeStr(ch?.config?.instagramBusinessId || recipientId);

        if (!pageAccessToken) {
          logger.warn({ tenantId }, "⚠️ IG webhook: sem accessToken no ChannelConfig.instagram");
          continue;
        }

        const sendRes = await igSendText({
          instagramBusinessId,
          recipientId: senderId,
          pageAccessToken,
          text: botText
        });

        if (!sendRes.ok) {
          logger.warn({ tenantId, sendRes }, "⚠️ IG webhook: falha ao enviar mensagem (Graph)");
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook POST error");
  }
});

export default router;
