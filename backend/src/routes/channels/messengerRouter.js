// backend/src/routes/channels/messengerRouter.js
// ✅ Patch: lookup por colunas (pageId / accessToken) em ChannelConfig
// - remove dependência de config.path (JSON path)
// - resolve tenant por pageId (multi-tenant real)
// - mantém compatibilidade: se accessToken/pageId não estiverem nas colunas, tenta fallback em config.*

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

// ===============================
// Helpers
// ===============================
function nowIso() {
  return new Date().toISOString();
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
  if (!META_APP_SECRET) return { ok: true, skipped: true, reason: "no_app_secret" };
  if (!sig) return { ok: false, reason: "missing_signature" };
  if (!req.rawBody) return { ok: true, skipped: true, reason: "no_raw_body" };

  const digest = crypto
    .createHmac("sha256", META_APP_SECRET)
    .update(req.rawBody)
    .digest("hex");

  const ok = timingSafeEqualHex(sig, `sha256=${digest}`);
  return ok ? { ok: true } : { ok: false, reason: "invalid_signature" };
}

function isMessageEvent(m) {
  if (!m) return false;
  if (m.message && m.message.is_echo) return false;
  return !!m.message;
}

function extractTextFromMessage(m) {
  const msg = m?.message || {};
  if (msg.text) return String(msg.text);
  return "";
}

function safeCfgJson(cfg) {
  const v = cfg?.config;
  if (v && typeof v === "object") return v;
  return {};
}

// ===============================
// ✅ DB helpers (colunas-first)
// ===============================
async function getChannelConfigForPageId(pageId) {
  if (!pageId) return null;

  // ✅ Preferência: coluna pageId
  const byColumn = await prisma.channelConfig.findFirst({
    where: {
      channel: "messenger",
      enabled: true,
      pageId: String(pageId),
    },
    orderBy: { updatedAt: "desc" },
  });
  if (byColumn) return byColumn;

  // 🔁 Fallback compat: tenta achar no config.pageId (se ainda estiver lá)
  // (mantém funcionando enquanto você migra valores para as colunas)
  try {
    return await prisma.channelConfig.findFirst({
      where: {
        channel: "messenger",
        enabled: true,
        // Prisma JSON filter (quando suportado)
        config: { path: ["pageId"], equals: String(pageId) },
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch {
    return null;
  }
}

async function getLatestEnabledMessengerConfig() {
  return prisma.channelConfig.findFirst({
    where: { channel: "messenger", enabled: true },
    orderBy: { updatedAt: "desc" },
  });
}

async function resolveTenantIdForWebhook(req, pageIdFromEvent) {
  const direct = req.tenant?.id || req.tenantId;
  if (direct) return String(direct);

  const h = String(req.headers["x-tenant-id"] || "").trim();
  if (h) return h;

  if (pageIdFromEvent) {
    const cfg = await getChannelConfigForPageId(pageIdFromEvent);
    if (cfg?.tenantId) return String(cfg.tenantId);
  }

  const def = String(process.env.MESSENGER_DEFAULT_TENANT_ID || "").trim();
  if (def) return def;

  const last = await getLatestEnabledMessengerConfig();
  if (last?.tenantId) return String(last.tenantId);

  return null;
}

async function getMsConfigForTenant(tenantId, pageIdFromEvent) {
  let cfg = null;

  // ✅ Preferência: se veio pageId, resolve diretamente por página (multi-tenant real)
  if (pageIdFromEvent) cfg = await getChannelConfigForPageId(pageIdFromEvent);

  // ✅ Fallback: config do tenant
  if (!cfg && tenantId) {
    cfg = await prisma.channelConfig.findFirst({
      where: { tenantId: String(tenantId), channel: "messenger", enabled: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  const cfgJson = safeCfgJson(cfg);

  // ✅ Preferência: colunas novas
  const accessToken = String(cfg?.accessToken || cfgJson?.accessToken || "").trim();
  const pageId = String(cfg?.pageId || cfgJson?.pageId || pageIdFromEvent || "").trim();

  return { cfg, accessToken, pageId };
}

async function sendMessengerText({ accessToken, recipientId, text }) {
  if (!accessToken) throw new Error("Messenger não configurado (accessToken ausente)");
  if (!recipientId) throw new Error("recipientId ausente");
  const body = String(text || "").trim();
  if (!body) return null;

  const url = `https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(
    accessToken
  )}`;

  const payload = {
    messaging_type: "RESPONSE",
    recipient: { id: String(recipientId) },
    message: { text: body },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(`Meta send failed (${resp.status}): ${JSON.stringify(json)}`);
  return json;
}

// ===============================
// ✅ GET /webhook/messenger
// ===============================
router.get("/", (req, res) => {
  const mode = String(req.query["hub.mode"] || "");
  const token = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");

  if (!VERIFY_TOKEN) {
    logger.error("❌ MESSENGER_VERIFY_TOKEN não configurado");
    return res.status(500).send("verify token not configured");
  }

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("✅ Messenger webhook verificado com sucesso");
    return res.status(200).send(challenge);
  }

  logger.warn({ mode, tokenLen: token.length }, "❌ Falha na verificação do webhook Messenger");
  return res.sendStatus(403);
});

// ===============================
// ✅ POST /webhook/messenger
// ===============================
router.post("/", async (req, res) => {
  const sig = validateMetaSignature(req);
  if (!sig.ok) {
    logger.warn({ sig }, "❌ Assinatura inválida no webhook Messenger");
    return res.sendStatus(403);
  }

  // Meta quer 200 rápido
  res.sendStatus(200);

  const body = req.body || {};
  if (body.object !== "page") return;

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const pageId = String(entry.id || "").trim();
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];

    const tenantId = await resolveTenantIdForWebhook(req, pageId);
    if (!tenantId) {
      logger.warn({ pageId }, "⚠️ Tenant não resolvido (Messenger)");
      continue;
    }

    const msCfg = await getMsConfigForTenant(tenantId, pageId);

    for (const m of events) {
      try {
        if (!isMessageEvent(m)) continue;

        const senderId = String(m.sender?.id || "").trim(); // PSID
        const recipientId = String(m.recipient?.id || "").trim(); // pageId
        const text = extractTextFromMessage(m);

        const conv = await getOrCreateChannelConversation({
          source: "messenger",
          channel: "messenger",
          tenantId,
          accountId: recipientId || msCfg.pageId || null,
          peerId: `ms:${senderId}`,
          meta: { pageId: recipientId || pageId || null },
        });

        await appendMessage(conv.id, {
          id: `ms_in_${m.timestamp || Date.now()}_${senderId}`,
          from: "client",
          direction: "in",
          channel: "messenger",
          type: m.message?.attachments?.length ? "attachment" : "text",
          text: text || "",
          msMessageId: String(m.message?.mid || ""),
          createdAt: nowIso(),
          raw: m,
        });

        // Se já está em humano/handoff → não responde bot
        if (conv.handoffActive || conv.currentMode === "human" || conv.inboxVisible) continue;

        // Só bot em texto por enquanto
        if (!text) continue;

        const accountSettings = { channel: "messenger", tenantId };
        const decision = await decideRoute({
          accountSettings,
          conversation: conv,
          messageText: text,
        });

        if (decision?.target && decision.target !== "bot") {
          try {
            if (msCfg.accessToken) {
              await sendMessengerText({
                accessToken: msCfg.accessToken,
                recipientId: senderId,
                text: HANDOFF_MESSAGE,
              });
            } else {
              logger.warn({ tenantId, pageId }, "⚠️ Sem accessToken do Messenger — handoff não enviado");
            }
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar handoff (Messenger)");
          }

          await appendMessage(conv.id, {
            id: `ms_out_handoff_${Date.now()}`,
            from: "bot",
            isBot: true,
            direction: "out",
            channel: "messenger",
            type: "text",
            text: HANDOFF_MESSAGE,
            handoff: true,
            createdAt: nowIso(),
          });

          continue;
        }

        let botText = "";
        try {
          botText = await callGenAIBot({
            accountSettings,
            conversation: conv,
            messageText: text,
          });
        } catch (e) {
          logger.error({ err: String(e), tenantId }, "❌ Erro botEngine (Messenger)");
          botText = "Desculpe, tive um problema aqui. Pode tentar de novo?";
        }

        try {
          if (msCfg.accessToken) {
            await sendMessengerText({
              accessToken: msCfg.accessToken,
              recipientId: senderId,
              text: botText,
            });
          } else {
            logger.warn({ tenantId, pageId }, "⚠️ Sem accessToken do Messenger — bot não enviado");
          }
        } catch (e) {
          logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar bot (Messenger)");
        }

        await appendMessage(conv.id, {
          id: `ms_out_bot_${Date.now()}`,
          from: "bot",
          isBot: true,
          direction: "out",
          channel: "messenger",
          type: "text",
          text: botText,
          createdAt: nowIso(),
        });
      } catch (e) {
        logger.error({ err: String(e), tenantId, pageId }, "❌ Erro processando evento Messenger");
      }
    }
  }
});

export default router;
