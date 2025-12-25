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

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

// Mensagem texto (apenas quando existir)
function msgTextFromIGEvent(ev) {
  return safeStr(ev?.message?.text || ev?.message?.body || ev?.text || "");
}

// Ignora eventos que não são mensagem de texto do usuário
function isValidIncomingTextEvent(ev) {
  const text = msgTextFromIGEvent(ev);
  if (!text) return false;

  // IG/Messenger podem mandar "echo" do que o app enviou
  if (ev?.message?.is_echo === true) return false;

  // alguns eventos vêm sem sender/recipient
  const senderId = safeStr(ev?.sender?.id);
  const recipientId = safeStr(ev?.recipient?.id);
  if (!senderId || !recipientId) return false;

  // evita auto-reply acidental
  if (senderId === recipientId) return false;

  return true;
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
  // instagramBusinessId fica em config.instagramBusinessId
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
        if (!isValidIncomingTextEvent(ev)) continue;

        const senderId = safeStr(ev?.sender?.id); // user
        const recipientId = safeStr(ev?.recipient?.id); // IG business id (recipient)
        const text = msgTextFromIGEvent(ev);

        // 1) resolve tenant via recipientId (instagramBusinessId)
        const ch = await resolveTenantByInstagramRecipient(recipientId);
        if (!ch?.tenantId) {
          logger.warn({ recipientId }, "⚠️ IG webhook: tenant não encontrado para recipientId");
          continue;
        }

        const tenantId = String(ch.tenantId);
        const cfg = asJson(ch.config);
        const instagramBusinessId = safeStr(cfg.instagramBusinessId || recipientId);
        const pageAccessToken = safeStr(ch.accessToken);

        if (!pageAccessToken) {
          logger.warn(
            { tenantId, recipientId },
            "⚠️ IG webhook: sem accessToken no ChannelConfig.instagram"
          );
          continue;
        }

        // 2) upsert conversa
        const convRes = await getOrCreateChannelConversation({
          tenantId,
          source: "instagram",
          peerId: senderId,
          title: "Contato Instagram"
        });

        if (!convRes?.ok || !convRes?.conversation?.id) continue;

        const conversation = convRes.conversation;
        const conversationId = String(conversation.id);

        // 3) salva mensagem recebida (dedupe usa waMessageId no conversations.js)
        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "client",
          direction: "in",
          type: "text",
          text,
          createdAt: new Date().toISOString(),
          waMessageId: ev?.message?.mid ? String(ev.message.mid) : undefined, // reusa campo p/ dedupe
          payload: ev
        });

        // 4) se já está em modo humano / handoff ativo, não roda bot
        if (
          String(conversation?.currentMode || "").toLowerCase() === "human" ||
          conversation?.handoffActive === true
        ) {
          continue;
        }

        // 5) regras do bot (accountId pode ser recipientId, ou "default")
        const accountSettings = getChatbotSettingsForAccount(recipientId || "default");

        const route = decideRoute({
          accountSettings,
          conversation,
          messageText: text
        });

        if (route?.target !== "bot") continue;

        // 6) gera resposta do bot (assinatura correta do botEngine)
        const botReply = await callGenAIBot({
          accountSettings,
          conversation: { ...conversation, id: conversationId }, // garante id para logs
          messageText: text,
          history: [] // opcional: aqui você pode buscar histórico no futuro
        });

        const botText = safeStr(botReply?.replyText || "");
        if (!botText) continue;

        // 7) salva a resposta do bot no histórico
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

        // 8) envia via Graph para o usuário (sender)
        const sendRes = await igSendText({
          instagramBusinessId,
          recipientId: senderId,
          pageAccessToken,
          text: botText
        });

        if (!sendRes.ok) {
          logger.warn(
            { tenantId, status: sendRes.status, meta: sendRes.json?.error || sendRes.json },
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
