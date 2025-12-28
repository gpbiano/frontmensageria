import express from "express";
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

const HANDOFF_MESSAGE = String(
  process.env.INSTAGRAM_HANDOFF_MESSAGE ||
    process.env.MESSENGER_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
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

  const senderId = safeStr(ev?.sender?.id);
  const recipientId = safeStr(ev?.recipient?.id);
  if (!senderId || !recipientId) return false;

  if (senderId === recipientId) return false;
  return true;
}

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
      recipient: { id: recipientId },
      message: { text: body }
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

/**
 * Resolve ChannelConfig pelo instagramBusinessId (recipient)
 * - Prioridade: config.instagramBusinessId
 * - Fallback: coluna pageId igual ao recipient (se você tiver esse formato em algum momento)
 */
async function resolveChannelByInstagramRecipient(instagramBusinessId) {
  const rid = String(instagramBusinessId || "").trim();
  if (!rid) return null;

  // config.instagramBusinessId
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

  // fallback (se algum dia o recipient bater com pageId)
  const byPageId = await prisma.channelConfig.findFirst({
    where: { channel: "instagram", enabled: true, status: "connected", pageId: rid },
    orderBy: { updatedAt: "desc" }
  });
  return byPageId || null;
}

function parseBotReplyToText(botReply) {
  // suporta botEngine retornando string ou objeto
  if (!botReply) return "";
  if (typeof botReply === "string") return safeStr(botReply);
  if (typeof botReply?.replyText === "string") return safeStr(botReply.replyText);
  if (typeof botReply?.text === "string") return safeStr(botReply.text);
  return safeStr(botReply?.message || "");
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
        const mid = ev?.message?.mid ? String(ev.message.mid) : "";

        // 1) resolve channelConfig via recipientId (instagramBusinessId)
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
          logger.warn(
            { tenantId, recipientId },
            "⚠️ IG webhook: sem accessToken no ChannelConfig.instagram"
          );
          continue;
        }

        // ✅ fonte de verdade: botEnabled no ChannelConfig(channel="instagram")
        const botEnabled = cfg.botEnabled === true;

        // 2) upsert conversa (peerId consistente)
        const convRes = await getOrCreateChannelConversation({
          tenantId,
          source: "instagram",
          channel: "instagram",
          peerId: `ig:${senderId}`,
          title: "Contato Instagram",
          accountId: instagramBusinessId || null,
          meta: {
            instagramBusinessId,
            recipientId,
            pageId: ch.pageId || null
          }
        });

        if (!convRes?.ok || !convRes?.conversation?.id) continue;

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
          createdAt: new Date().toISOString(),
          waMessageId: mid || undefined,
          payload: ev
        });

        // 4) se já está em humano/handoff ativo → não roda bot
        if (
          String(conversation?.currentMode || "").toLowerCase() === "human" ||
          conversation?.handoffActive === true ||
          conversation?.inboxVisible === true
        ) {
          continue;
        }

        // 5) se bot está OFF → força handoff/inbox
        if (!botEnabled) {
          // manda mensagem de handoff (best-effort)
          try {
            await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ IG webhook: falha ao enviar handoff (bot disabled)");
          }

          // promove para Inbox via handoff:true
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
            createdAt: new Date().toISOString(),
            payload: { kind: "handoff_disabled_bot", instagramBusinessId }
          });

          continue;
        }

        // 6) decide rota (bot vs handoff)
        const accountSettings = { channel: "instagram", tenantId, instagramBusinessId };
        const route = await decideRoute({
          accountSettings,
          conversation,
          messageText: text
        });

        // ✅ HANDOFF REAL
        if (route?.target && route.target !== "bot") {
          try {
            await igSendText({
              instagramBusinessId,
              recipientId: senderId,
              pageAccessToken,
              text: HANDOFF_MESSAGE
            });
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ IG webhook: falha ao enviar handoff (route)");
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
            createdAt: new Date().toISOString(),
            payload: { kind: "handoff", instagramBusinessId }
          });

          continue;
        }

        // 7) BOT
        let botText = "";
        try {
          const botReply = await callGenAIBot({
            accountSettings,
            conversation: { ...conversation, id: conversationId },
            messageText: text,
            history: [] // opcional no futuro
          });

          botText = parseBotReplyToText(botReply);
          if (!botText) botText = "Entendi. Pode me dar mais detalhes?";
        } catch (e) {
          logger.error({ err: String(e), tenantId }, "❌ IG webhook: erro botEngine");
          botText = "Desculpe, tive um problema aqui. Pode tentar de novo?";
        }

        // 8) envia pro usuário
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

        // 9) salva bot no histórico
        await appendMessage(conversationId, {
          tenantId,
          source: "instagram",
          channel: "instagram",
          from: "bot",
          isBot: true,
          direction: "out",
          type: "text",
          text: botText,
          createdAt: new Date().toISOString(),
          payload: { kind: "bot" }
        });
      }
    }
  } catch (e) {
    logger.error({ err: e }, "❌ IG webhook POST error");
  }
});

export default router;
