// backend/src/routes/channels/messengerRouter.js
// GP Labs — Messenger Webhook (padrão WhatsApp: multi-tenant + conversas core + bot/handoff)
// - GET  /webhook/messenger  (verificação)
// - POST /webhook/messenger  (eventos)
//
// ✅ Requisitos (env):
// - MESSENGER_VERIFY_TOKEN (ou VERIFY_TOKEN como fallback)
// - META_APP_SECRET (opcional, para validar assinatura x-hub-signature-256)
// - PUBLIC_API_BASE_URL (opcional; links)
// - MESSENGER_DEFAULT_TENANT_ID (opcional; fallback de tenant)
//
// ✅ Persistência (Prisma):
// - ChannelConfig (tenantId + channel="messenger") com config.accessToken (Page token) e config.pageId
//
// ✅ Conversas core:
// - getOrCreateChannelConversation(db, payload)
// - appendMessage(db, conversationId, msg)
//
// ⚠️ Assinatura:
// Para validar assinatura de verdade, o Express precisa expor req.rawBody.
// No index.js, use:
//   app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
//

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
  process.env.MESSENGER_VERIFY_TOKEN ||
    process.env.VERIFY_TOKEN ||
    ""
).trim();

const META_APP_SECRET = String(process.env.META_APP_SECRET || "").trim();

const HANDOFF_MESSAGE = String(
  process.env.MESSENGER_HANDOFF_MESSAGE ||
    "Aguarde um momento, vou te transferir para um atendente humano."
).trim();

// ======================================================
// Helpers
// ======================================================
function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

function optionalEnv(name) {
  return String(process.env[name] || "").trim();
}

function nowIso() {
  return new Date().toISOString();
}

function safeJson(x) {
  try {
    return JSON.parse(x);
  } catch {
    return null;
  }
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
  // Messenger também usa x-hub-signature-256 (HMAC SHA256)
  // Só valida se:
  // - META_APP_SECRET configurado
  // - req.rawBody disponível (ver observação no topo)
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

async function getChannelConfigForPageId(pageId) {
  if (!pageId) return null;
  try {
    // ChannelConfig deve ter:
    // - channel: "messenger"
    // - config.pageId: "<pageId>"
    // - config.accessToken: "<pageAccessToken>"
    //
    // ⚠️ Dependendo do seu schema Prisma, "config" pode ser Json.
    // Aqui usamos findFirst com path JSON (Postgres) via Prisma:
    // Se não suportar no seu setup atual, a alternativa é armazenar pageId em coluna dedicada.
    return await prisma.channelConfig.findFirst({
      where: {
        channel: "messenger",
        enabled: true,
        // JSON path filter (Postgres)
        config: {
          path: ["pageId"],
          equals: String(pageId),
        },
      },
      orderBy: { updatedAt: "desc" },
    });
  } catch (e) {
    logger.warn({ err: String(e), pageId }, "⚠️ getChannelConfigForPageId fallback (JSON path not supported?)");
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
  // 1) Se já veio resolvido por middleware (se você aplica resolveTenant nas rotas públicas)
  const direct = req.tenant?.id || req.tenantId;
  if (direct) return String(direct);

  // 2) Header explícito
  const h = String(req.headers["x-tenant-id"] || "").trim();
  if (h) return h;

  // 3) Melhor estratégia: mapear por pageId do evento (entry.id)
  if (pageIdFromEvent) {
    const cfg = await getChannelConfigForPageId(pageIdFromEvent);
    if (cfg?.tenantId) return String(cfg.tenantId);
  }

  // 4) Fallback env (ambiente single-tenant)
  const def = String(process.env.MESSENGER_DEFAULT_TENANT_ID || "").trim();
  if (def) return def;

  // 5) Último recurso: último messenger enabled (não ideal para multi-tenant real)
  const last = await getLatestEnabledMessengerConfig();
  if (last?.tenantId) return String(last.tenantId);

  return null;
}

async function getMsConfigForTenant(tenantId, pageIdFromEvent) {
  // Estrutura sugerida em ChannelConfig.config:
  // {
  //   accessToken: "EAAG....",     // Page Access Token
  //   pageId: "1234567890",
  //   status: "connected"
  // }
  //
  // ⚠️ Se pageIdFromEvent existir e você tiver configs por página, preferimos essa.
  let cfg = null;

  if (pageIdFromEvent) {
    cfg = await getChannelConfigForPageId(pageIdFromEvent);
  }

  if (!cfg && tenantId) {
    cfg = await prisma.channelConfig.findFirst({
      where: { tenantId: String(tenantId), channel: "messenger", enabled: true },
      orderBy: { updatedAt: "desc" },
    });
  }

  const config = cfg?.config && typeof cfg.config === "object" ? cfg.config : safeJson(cfg?.config);

  const accessToken = String(config?.accessToken || "").trim();
  const pageId = String(config?.pageId || pageIdFromEvent || "").trim();

  return { cfg, accessToken, pageId };
}

function isMessageEvent(m) {
  // Evento "message" costuma vir em entry.messaging[]
  // Ignorar echo (mensagens enviadas pela própria página)
  if (!m) return false;
  if (m.message && m.message.is_echo) return false;
  return !!m.message;
}

function extractTextFromMessage(m) {
  const msg = m?.message || {};
  if (msg.text) return String(msg.text);
  // attachments: imagem, vídeo, etc.
  return "";
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
  if (!resp.ok) {
    throw new Error(`Meta send failed (${resp.status}): ${JSON.stringify(json)}`);
  }
  return json; // { recipient_id, message_id }
}

// ======================================================
// 1) Verificação (Webhook Verify)
// ======================================================
router.get("/webhook/messenger", (req, res) => {
  // Meta: hub.mode, hub.verify_token, hub.challenge
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

// ======================================================
// 2) Recebimento de Eventos (POST)
// ======================================================
router.post("/webhook/messenger", async (req, res) => {
  // Validação opcional de assinatura (recomendado em produção)
  const sig = validateMetaSignature(req);
  if (!sig.ok) {
    logger.warn({ sig }, "❌ Assinatura inválida no webhook Messenger");
    return res.sendStatus(403);
  }

  // A Meta espera 200 rápido
  res.sendStatus(200);

  const body = req.body || {};
  // Messenger costuma vir com object: "page"
  if (body.object !== "page") {
    logger.info({ object: body.object }, "ℹ️ Evento ignorado (não é page)");
    return;
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  for (const entry of entries) {
    const pageId = String(entry.id || "").trim();
    const events = Array.isArray(entry.messaging) ? entry.messaging : [];

    let tenantId = null;
    try {
      tenantId = await resolveTenantIdForWebhook(req, pageId);
      if (!tenantId) {
        logger.warn({ pageId }, "⚠️ Tenant não resolvido para webhook Messenger (evento ignorado)");
        continue;
      }
    } catch (e) {
      logger.error({ err: String(e), pageId }, "❌ Erro ao resolver tenant do webhook Messenger");
      continue;
    }

    let msCfg = null;
    try {
      msCfg = await getMsConfigForTenant(tenantId, pageId);
    } catch (e) {
      logger.error({ err: String(e), tenantId, pageId }, "❌ Erro ao carregar config Messenger do tenant");
      continue;
    }

    for (const m of events) {
      try {
        // Mensagens
        if (isMessageEvent(m)) {
          const senderId = String(m.sender?.id || "").trim(); // PSID
          const recipientId = String(m.recipient?.id || "").trim(); // pageId
          const text = extractTextFromMessage(m);

          // Cria/reusa conversa do canal "messenger"
          const conv = await getOrCreateChannelConversation(
            // conversations.js atual costuma usar loadDB internamente ou prisma.
            // Se sua versão exige db explícito, adapte aqui.
            // Neste router seguimos o mesmo "padrão WhatsApp": chamar a função core e deixar ela decidir.
            {
              source: "messenger",
              channel: "messenger",
              tenantId,
              accountId: recipientId || msCfg.pageId || null,
              peerId: `ms:${senderId}`, // padrão peerId por canal
              meta: { pageId: recipientId || pageId || null },
            }
          );

          // Persistir inbound
          const inbound = {
            id: `ms_in_${m.timestamp || Date.now()}_${senderId}`,
            from: "client",
            direction: "in",
            channel: "messenger",
            type: m.message?.attachments?.length ? "attachment" : "text",
            text: text || "",
            msMessageId: String(m.message?.mid || ""),
            createdAt: nowIso(),
            raw: m,
          };

          await appendMessage(conv.id, inbound);

          // Se conversa já está em humano/handoff → não responde bot
          if (conv.handoffActive || conv.currentMode === "human" || conv.inboxVisible) {
            continue;
          }

          // Só bot em texto por enquanto
          if (!text) continue;

          // Decide rota (bot x humano)
          const accountSettings = await (async () => {
            // Se você já tem settings por "accountId/pageId", pluga aqui.
            // Mantemos compatível com seu rulesEngine atual.
            return { channel: "messenger", tenantId };
          })();

          const decision = await decideRoute({
            accountSettings,
            conversation: conv,
            messageText: text,
          });

          if (decision?.target && decision.target !== "bot") {
            // Handoff
            const handoffMsg = {
              id: `ms_out_handoff_${Date.now()}`,
              from: "bot",
              isBot: true,
              direction: "out",
              channel: "messenger",
              type: "text",
              text: HANDOFF_MESSAGE,
              handoff: true,
              createdAt: nowIso(),
            };

            // envia
            try {
              if (msCfg?.accessToken) {
                await sendMessengerText({
                  accessToken: msCfg.accessToken,
                  recipientId: senderId,
                  text: HANDOFF_MESSAGE,
                });
              } else {
                logger.warn({ tenantId, pageId }, "⚠️ Sem accessToken do Messenger — handoff message não enviada");
              }
            } catch (e) {
              logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar handoff no Messenger");
            }

            await appendMessage(conv.id, handoffMsg);
            // A promoção para inbox (se existir) deve acontecer no core ao detectar handoff:true
            continue;
          }

          // Bot response
          let botText = "";
          try {
            botText = await callGenAIBot({
              accountSettings,
              conversation: conv,
              messageText: text,
            });
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ Erro no botEngine (Messenger)");
            botText = "Desculpe, tive um problema aqui. Pode tentar de novo?";
          }

          const botMsg = {
            id: `ms_out_bot_${Date.now()}`,
            from: "bot",
            isBot: true,
            direction: "out",
            channel: "messenger",
            type: "text",
            text: botText,
            createdAt: nowIso(),
          };

          // envia
          try {
            if (msCfg?.accessToken) {
              const r = await sendMessengerText({
                accessToken: msCfg.accessToken,
                recipientId: senderId,
                text: botText,
              });
              botMsg.metaMessageId = String(r?.message_id || "");
            } else {
              logger.warn({ tenantId, pageId }, "⚠️ Sem accessToken do Messenger — bot message não enviada");
            }
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar mensagem bot no Messenger");
          }

          await appendMessage(conv.id, botMsg);
          continue;
        }

        // Postbacks (botões)
        if (m?.postback) {
          const senderId = String(m.sender?.id || "").trim();
          const payload = String(m.postback?.payload || "").trim();

          const conv = await getOrCreateChannelConversation({
            source: "messenger",
            channel: "messenger",
            tenantId,
            accountId: String(m.recipient?.id || msCfg.pageId || pageId || ""),
            peerId: `ms:${senderId}`,
          });

          const inbound = {
            id: `ms_in_postback_${m.timestamp || Date.now()}_${senderId}`,
            from: "client",
            direction: "in",
            channel: "messenger",
            type: "postback",
            text: payload,
            createdAt: nowIso(),
            raw: m,
          };

          await appendMessage(conv.id, inbound);

          // Se já está em humano/handoff, não chama bot
          if (conv.handoffActive || conv.currentMode === "human" || conv.inboxVisible) {
            continue;
          }

          // Trata postback como texto para roteamento/bot (opcional)
          const accountSettings = { channel: "messenger", tenantId };
          const decision = await decideRoute({
            accountSettings,
            conversation: conv,
            messageText: payload,
          });

          if (decision?.target && decision.target !== "bot") {
            try {
              if (msCfg?.accessToken) {
                await sendMessengerText({
                  accessToken: msCfg.accessToken,
                  recipientId: senderId,
                  text: HANDOFF_MESSAGE,
                });
              }
            } catch (e) {
              logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar handoff (postback) no Messenger");
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
              messageText: payload,
            });
          } catch {
            botText = "Ok! 🙂";
          }

          try {
            if (msCfg?.accessToken) {
              await sendMessengerText({
                accessToken: msCfg.accessToken,
                recipientId: senderId,
                text: botText,
              });
            }
          } catch (e) {
            logger.error({ err: String(e), tenantId }, "❌ Falha ao enviar bot (postback) no Messenger");
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

          continue;
        }

        // Outros eventos (delivery, read, etc.) — ignore por enquanto
      } catch (e) {
        logger.error(
          { err: String(e), tenantId, pageId, event: m },
          "❌ Erro processando evento Messenger"
        );
      }
    }
  }
});

export default router;
