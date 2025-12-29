// backend/src/routes/channels/messengerRouter.js
// ✅ Alinhado com conversations.js (core)
// - botEnabled vem EXCLUSIVAMENTE de ChannelConfig.config.botEnabled (default: TRUE)
// - Inbox/Handoff é sempre promovido via appendMessage({ handoff:true })
// - Nunca altera estado direto da conversation (exceto: metadata/title para perfil via Conversation.metadata + Contact)
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

function asJson(obj) {
  return obj && typeof obj === "object" ? obj : {};
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

  return timingSafeEqualHex(sig, `sha256=${digest}`)
    ? { ok: true }
    : { ok: false };
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
// Profile cache (evita bater no Graph a cada msg)
// ======================================================
const msProfileCache = new Map(); // key: senderId -> { ts, name, avatarUrl }
const MS_PROFILE_TTL_MS = 1000 * 60 * 60 * 6; // 6h

function cacheGetMs(senderId) {
  const v = msProfileCache.get(senderId);
  if (!v) return null;
  if (Date.now() - v.ts > MS_PROFILE_TTL_MS) {
    msProfileCache.delete(senderId);
    return null;
  }
  return v;
}

function cacheSetMs(senderId, data) {
  msProfileCache.set(senderId, { ts: Date.now(), ...data });
}

// ======================================================
// ChannelConfig helpers
// ======================================================
async function getChannelConfigForPageId(pageId) {
  if (!pageId) return null;

  return prisma.channelConfig.findFirst({
    where: { channel: "messenger", enabled: true, pageId: String(pageId) },
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
      where: { tenantId: String(tenantId), channel: "messenger", enabled: true },
      orderBy: { updatedAt: "desc" }
    });
  }

  return {
    accessToken: safeStr(cfg?.accessToken),
    pageId: safeStr(cfg?.pageId || pageId),
    config: asJson(cfg?.config),
    channelId: safeStr(cfg?.id)
  };
}

// ✅ DEFAULT: bot ligado. Só desliga se config.botEnabled === false
async function isMessengerBotEnabledForPage(tenantId, pageId) {
  try {
    const cfg = await getChannelConfigForPageId(pageId);
    if (cfg?.tenantId && String(cfg.tenantId) !== String(tenantId)) {
      // em teoria não acontece (tenantId já vem resolvido por page), mas fica seguro
    }
    const c = asJson(cfg?.config);
    return c.botEnabled !== false;
  } catch {
    return true;
  }
}

// ======================================================
// ✅ Graph profile fetch (Messenger)
// ======================================================
async function fetchMessengerProfile({ accessToken, senderId }) {
  try {
    if (!accessToken || !senderId) return null;

    const cached = cacheGetMs(senderId);
    if (cached) return cached;

    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(
      senderId
    )}?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(accessToken)}`;

    const resp = await fetch(url);
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn(
        { senderId, status: resp.status, error: json?.error || json },
        "⚠️ MS profile fetch falhou"
      );
      return null;
    }

    const first = safeStr(json?.first_name);
    const last = safeStr(json?.last_name);
    const name = safeStr([first, last].filter(Boolean).join(" "), "Contato");
    const avatarUrl = safeStr(json?.profile_pic);

    const data = { name, avatarUrl };
    cacheSetMs(senderId, data);
    return data;
  } catch (e) {
    logger.warn({ err: String(e), senderId }, "⚠️ MS profile fetch exception");
    return null;
  }
}

// ======================================================
// ✅ Persist identity (Contact + Conversation.metadata)
// - Conversation NÃO tem campo `title` nem `meta`
// - Tudo vai em Conversation.metadata + Contact.name/avatarUrl
// ======================================================
async function persistIdentity({
  tenantId,
  peerId,
  name,
  avatarUrl,
  metaExtra = {},
  preferConversationId = null
}) {
  try {
    const tid = safeStr(tenantId);
    const pid = safeStr(peerId);
    if (!tid || !pid) return;

    const channel = "messenger";
    const safeName = safeStr(name);
    const safeAvatar = safeStr(avatarUrl);

    // 1) Contact é fonte de verdade (nome/avatar)
    const contact = await prisma.contact
      .upsert({
        where: {
          tenantId_channel_externalId: {
            tenantId: tid,
            channel,
            externalId: pid
          }
        },
        update: {
          ...(safeName ? { name: safeName } : {}),
          ...(safeAvatar ? { avatarUrl: safeAvatar } : {}),
          ...(metaExtra && Object.keys(metaExtra).length
            ? { metadata: asJson(metaExtra) }
            : {})
        },
        create: {
          tenantId: tid,
          channel,
          externalId: pid,
          name: safeName || null,
          avatarUrl: safeAvatar || null,
          metadata:
            metaExtra && Object.keys(metaExtra).length ? asJson(metaExtra) : undefined
        },
        select: { id: true }
      })
      .catch(() => null);

    if (!contact?.id) return;

    // 2) Atualiza Conversation.metadata (merge) — preferindo a conversation atual
    let conv = null;

    if (preferConversationId) {
      conv = await prisma.conversation
        .findUnique({
          where: { id: String(preferConversationId) },
          select: { id: true, metadata: true, contactId: true }
        })
        .catch(() => null);
    }

    if (!conv?.id) {
      conv = await prisma.conversation
        .findFirst({
          where: { tenantId: tid, contactId: contact.id, channel },
          orderBy: { updatedAt: "desc" },
          select: { id: true, metadata: true, contactId: true }
        })
        .catch(() => null);
    }

    if (!conv?.id) return;

    const patch = {
      ...(safeName ? { title: safeName } : {}),
      ...(safeAvatar ? { avatarUrl: safeAvatar } : {}),
      ...(metaExtra && Object.keys(metaExtra).length ? metaExtra : {})
    };

    if (Object.keys(patch).length) {
      await prisma.conversation
        .update({
          where: { id: conv.id },
          data: { metadata: { ...asJson(conv.metadata), ...patch } }
        })
        .catch(() => {});
    }

    // 3) garante vínculo conv -> contact (caso conversations.js tenha criado conv antes do contact)
    if (String(conv.contactId || "") !== String(contact.id)) {
      await prisma.conversation
        .update({
          where: { id: conv.id },
          data: { contactId: contact.id }
        })
        .catch(() => {});
    }
  } catch (e) {
    logger.warn(
      { err: String(e), tenantId, peerId },
      "⚠️ MS: falha ao persistir identity"
    );
  }
}

// ======================================================
// Send
// ======================================================
async function sendMessengerText({ accessToken, recipientId, text }) {
  if (!accessToken || !recipientId || !text) return;

  await fetch(
    `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(
      accessToken
    )}`,
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

    // ✅ botEnabled por page (default: ligado)
    const botEnabled = await isMessengerBotEnabledForPage(tenantId, pageId);

    for (const m of entry.messaging || []) {
      if (!isMessageEvent(m)) continue;

      const senderId = safeStr(m.sender?.id);
      const text = extractText(m);
      const peerId = `ms:${senderId}`;

      // ✅ perfil (nome + foto)
      const prof = await fetchMessengerProfile({ accessToken, senderId });
      const displayName = safeStr(prof?.name, "Contato");
      const avatarUrl = safeStr(prof?.avatarUrl);

      // ✅ cria/pega conversa
      // (conversations.js pode usar title/meta internamente, mas nossa persistência é feita abaixo)
      const convRes = await getOrCreateChannelConversation({
        tenantId,
        source: "messenger",
        channel: "messenger",
        peerId,
        title: displayName || "Contato",
        meta: {
          peerId,
          senderId,
          pageId,
          ...(avatarUrl ? { avatarUrl } : {})
        }
      });

      if (!convRes?.ok) continue;
      const conv = convRes.conversation;

      // ✅ salva identity no lugar certo (Contact + Conversation.metadata)
      const convTitle = safeStr(conv?.title); // pode vir vazio dependendo do core
      const isGenericTitle =
        !convTitle || convTitle.toLowerCase() === "contato";

      if (
        isGenericTitle ||
        (displayName && displayName !== "Contato") ||
        avatarUrl
      ) {
        await persistIdentity({
          tenantId,
          peerId,
          name: displayName && displayName !== "Contato" ? displayName : undefined,
          avatarUrl,
          metaExtra: { senderId, pageId },
          preferConversationId: conv.id
        });
      }

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
          payload: { kind: "handoff", decision }
        });
        continue;
      }

      // BOT
      let botText = "";
      try {
        const r = await callGenAIBot({
          accountSettings: { tenantId, channel: "messenger" },
          conversation: conv,
          messageText: text
        });

        // botEngine pode retornar { replyText } ou string
        botText = safeStr(r?.replyText ?? r);
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
