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
  // formatos comuns:
  // ev.message.text
  // ev.message?.text
  const t =
    ev?.message?.text ||
    ev?.message?.body ||
    ev?.text ||
    ev?.message ||
    "";
  return safeStr(t);
}

async function igSendText({ instagramBusinessId, recipientId, pageAccessToken, text }) {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
    instagramBusinessId
  )}/messages?access_token=${encodeURIComponent(pageAccessToken)}`;

  const body = {
    recipient: { id: recipientId },
    message: { text }
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
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
  // procura canal instagram cujo config.instagramBusinessId == recipient
  return prisma.channelConfig.findFirst({
    where: {
      channel: "instagram",
      enabled: true,
      status: "connected",
      config: {
        path: ["instagramBusinessId"],
        equals: String(instagramBusinessId)
      }
    },
    orderBy: { updatedAt: "desc" }
  });
}

// ======================================================
// GET /webhook/instagram  (verificação do Meta Webhook)
// ======================================================
router.get("/", (req, res) => {
  try {
    const mode = safeStr(req.query["hub.mode"]);
    const token = safeStr(req.query["hub.verify_token"]);
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token && VERIFY_TOKEN && token === VERIFY_TOKEN) {
      return res.status(200).send(String(challenge || ""));
    }

    return res.status(403).send("forbidden");
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook verify error");
    return res.status(500).send("error");
  }
});

// ======================================================
// POST /webhook/instagram  (eventos)
// ======================================================
router.post("/", async (req, res) => {
  // responde rápido pra Meta
  res.sendStatus(200);

  try {
    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [];

    for (const entry of entries) {
      // alguns formatos: entry.messaging (parecido com messenger)
      const events = Array.isArray(entry.messaging) ? entry.messaging : [];

      for (const ev of events) {
        const senderId = safeStr(ev?.sender?.id); // usuário final
        const recipientId = safeStr(ev?.recipient?.id); // IG business id (nosso)
        const text = msgTextFromIGEvent(ev);

        if (!senderId || !recipientId) continue;
        if (!text) continue; // por enquanto só texto

        const ch = await resolveTenantByInstagramRecipient(recipientId);
        if (!ch?.tenantId) {
          logger.warn(
            { recipientId },
            "⚠️ IG webhook: tenant não encontrado para instagramBusinessId (recipient)"
          );
          continue;
        }

        const tenantId = String(ch.tenantId);

        // 1) cria/acha conversa
        const convRes = await getOrCreateChannelConversation({
          tenantId,
          source: "instagram",
          peerId: senderId,
          title: "Contato Instagram"
        });

        if (!convRes?.ok || !convRes?.conversation?.id) {
          logger.warn({ tenantId, senderId, convRes }, "⚠️ IG webhook: falha ao criar conversa");
          continue;
        }

        const conversationId = String(convRes.conversation.id);

        // 2) salva mensagem recebida
        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "client",
          direction: "in",
          type: "text",
          text,
          createdAt: new Date().toISOString(),
          // dedupe (se vier)
          waMessageId: ev?.message?.mid ? String(ev.message.mid) : undefined,
          payload: ev
        });

        // 3) decide rota do bot
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

        if (route?.mode !== "bot") {
          // handoff / humano / etc
          continue;
        }

        // 4) gera resposta do bot
        const botReply = await callGenAIBot({
          tenantId,
          channel: "instagram",
          conversationId,
          text,
          settings: botSettings
        });

        const botText = safeStr(botReply?.text || botReply?.message || botReply || "");
        if (!botText) continue;

        // 5) salva msg do bot
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

        // 6) envia resposta pro IG via Graph (usa token salvo no ChannelConfig)
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
          logger.warn(
            { tenantId, sendRes },
            "⚠️ IG webhook: falha ao enviar mensagem (Graph)"
          );
        }
      }
    }
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook POST error");
  }
});

export default router;
