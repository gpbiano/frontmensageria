// backend/src/routes/webchat.js
import express from "express";
import jwt from "jsonwebtoken";
import { loadDB, saveDB } from "../utils/db.js";

// ✅ CORE OFICIAL (Modelo A + appendMessage)
import { getOrCreateChannelConversation, appendMessage } from "./conversations.js";

const router = express.Router();

const JWT_SECRET = process.env.WEBCHAT_JWT_SECRET || "webchat_secret_dev";
const TOKEN_TTL_SECONDS = 60 * 60; // 1h

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function nowIso() {
  return new Date().toISOString();
}

function ensureDbShape(db) {
  if (!db.conversations) db.conversations = [];
  if (!db.messagesByConversation) db.messagesByConversation = {};
  if (!db.channels) db.channels = {};
  if (!db.channels.webchat) {
    db.channels.webchat = {
      enabled: true,
      widgetKey: "",
      allowedOrigins: [],
      config: {}
    };
  }
  if (!db.chatbot) db.chatbot = {};
  return db;
}

function getConversationOr404(db, id) {
  return db.conversations.find((c) => String(c.id) === String(id)) || null;
}

/**
 * -------------------------------
 * Auth helpers (Widget token)
 * -------------------------------
 * Aceita token em:
 * - Authorization: Webchat <token>
 * - x-webchat-token: <token>
 * - ?token=<token>  (fallback para casos onde o widget não manda header no close)
 */
function readAuthToken(req) {
  const auth = String(req.headers.authorization || "");
  if (auth.startsWith("Webchat ")) return auth.slice("Webchat ".length).trim();

  const xToken = String(req.headers["x-webchat-token"] || "").trim();
  if (xToken) return xToken;

  const qToken = String(req.query.token || "").trim();
  if (qToken) return qToken;

  return "";
}

function verifyWebchatToken(req) {
  const token = readAuthToken(req);
  if (!token) throw new Error("Token ausente");
  return jwt.verify(token, JWT_SECRET);
}

/**
 * -------------------------------
 * Channel Config (WebChat)
 * -------------------------------
 * Respeita:
 * - enabled
 * - allowedOrigins (valida contra Origin)
 * - widgetKey (valida contra x-widget-key ou widgetKey query)
 */
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  // remove trailing slash
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function getRequestOrigin(req) {
  // browsers send Origin; some proxies may send Referer
  const origin = normalizeOrigin(req.headers.origin);
  if (origin) return origin;

  const ref = String(req.headers.referer || "").trim();
  try {
    if (ref) return normalizeOrigin(new URL(ref).origin);
  } catch (_) {}
  return "";
}

function readWidgetKey(req) {
  const h = String(req.headers["x-widget-key"] || "").trim();
  if (h) return h;
  const q = String(req.query.widgetKey || req.query.widget_key || "").trim();
  return q;
}

function isOriginAllowed(origin, allowedOrigins) {
  // Se não há Origin (teste server-to-server), libera.
  if (!origin) return true;

  const allowed = Array.isArray(allowedOrigins) ? allowedOrigins.map(normalizeOrigin) : [];
  if (!allowed.length) return false;

  return allowed.includes(normalizeOrigin(origin));
}

function assertWebchatAllowed(db, req) {
  const webchat = db.channels?.webchat || {};
  const enabled = webchat.enabled !== false; // default true
  if (!enabled) {
    return { ok: false, status: 403, error: "WebChat desativado" };
  }

  const origin = getRequestOrigin(req);
  const allowedOrigins = webchat.allowedOrigins || [];
  if (!isOriginAllowed(origin, allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: "Origin não permitido",
      details: { origin, allowedOrigins }
    };
  }

  // widgetKey: se configurada, é obrigatória
  const configuredKey = String(webchat.widgetKey || "").trim();
  if (configuredKey) {
    const key = readWidgetKey(req);
    if (!key || key !== configuredKey) {
      return { ok: false, status: 403, error: "widgetKey inválida ou ausente" };
    }
  }

  return { ok: true };
}

/**
 * -------------------------------
 * Chatbot (WebChat) — ativação
 * -------------------------------
 * Estratégia simples e segura:
 * - Se "chatbot.webchatEnabled === true", o session já nasce com currentMode="bot"
 * - Ao receber mensagem do cliente, se currentMode === "bot", geramos resposta do bot
 * - Não competimos com humano: se currentMode === "human", não chamamos bot
 *
 * OBS: Implementação defensiva:
 * - Se botEngine não existir/import falhar, não quebra o WebChat
 */
function isWebchatBotEnabled(db) {
  // você pode trocar o campo para o que preferir (ex.: db.chatbot.webchat.enabled)
  return db.chatbot?.webchatEnabled === true;
}

async function maybeReplyWithBot(db, conv, cleanText) {
  if (!isWebchatBotEnabled(db)) return { ok: true, didBot: false };

  // regra de ouro: não competir com humano
  if (String(conv.currentMode || "") === "human") return { ok: true, didBot: false };
  if (String(conv.status || "") !== "open") return { ok: true, didBot: false };

  let botEngine;
  try {
    // Ajuste o caminho se o seu botEngine estiver em outro lugar
    const mod = await import("../chatbot/botEngine.js");
    botEngine = mod?.default || mod?.botEngine || mod;
  } catch (_) {
    // botEngine não disponível ainda → não quebra o webchat
    return { ok: true, didBot: false };
  }

  if (typeof botEngine !== "function" && typeof botEngine?.run !== "function") {
    return { ok: true, didBot: false };
  }

  // pega um “contexto” curto das últimas mensagens
  const convId = String(conv.id);
  const all = Array.isArray(db.messagesByConversation?.[convId]) ? db.messagesByConversation[convId] : [];
  const lastMsgs = all.slice(-10).map((m) => ({
    from: m.from,
    direction: m.direction,
    text: m.text || m.body || m.content || ""
  }));

  let botText = "";
  try {
    if (typeof botEngine === "function") {
      botText = await botEngine({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: lastMsgs
      });
    } else if (typeof botEngine?.run === "function") {
      botText = await botEngine.run({
        channel: "webchat",
        conversation: conv,
        userText: cleanText,
        messages: lastMsgs
      });
    }
  } catch (_) {
    return { ok: true, didBot: false };
  }

  botText = String(botText || "").trim();
  if (!botText) return { ok: true, didBot: false };

  const r = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "bot",
    isBot: true,
    direction: "out",
    text: botText,
    createdAt: nowIso()
  });

  if (!r?.ok) return { ok: false, error: r?.error || "Falha ao salvar resposta do bot" };

  return { ok: true, didBot: true, botMessage: r.msg, botText };
}

/**
 * -------------------------------
 * (Opcional) Preflight friendly
 * -------------------------------
 * Se o seu widget roda em browsers, OPTIONS ajuda.
 */
router.options("*", (req, res) => {
  res.status(204).end();
});

// ----------------------------------------------------
// POST /webchat/session
// Cria ou reaproveita conversa (somente WEBCHAT)
// ----------------------------------------------------
router.post("/session", (req, res) => {
  const { visitorId } = req.body || {};
  if (!visitorId) return res.status(400).json({ error: "visitorId obrigatório" });

  const db = ensureDbShape(loadDB());

  // ✅ Respeitar Settings → Canais (enabled/origin/widgetKey)
  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  // Decide modo inicial: se chatbot habilitado no WebChat, nasce em "bot", senão "human"
  const initialMode = isWebchatBotEnabled(db) ? "bot" : "human";

  // ✅ cria/reutiliza via CORE (Modelo A)
  const r = getOrCreateChannelConversation(db, {
    source: "webchat",
    peerId: `wc:${visitorId}`,
    visitorId,
    title: `WebChat ${String(visitorId).slice(0, 6)}`,
    currentMode: initialMode
  });

  if (!r?.ok) return res.status(400).json({ error: r?.error || "Falha ao criar sessão" });

  const conversation = r.conversation;

  const token = jwt.sign(
    {
      conversationId: conversation.id,
      visitorId,
      source: "webchat",
      iat: nowUnix(),
      exp: nowUnix() + TOKEN_TTL_SECONDS
    },
    JWT_SECRET
  );

  saveDB(db);

  return res.json({
    conversationId: conversation.id,
    webchatToken: token,
    status: conversation.status,
    currentMode: conversation.currentMode,
    expiresInSeconds: TOKEN_TTL_SECONDS
  });
});

// ----------------------------------------------------
// GET /webchat/conversations/:id/messages?after=<cursor>&limit=50
// Retorna novas mensagens (polling do widget)
// ----------------------------------------------------
router.get("/conversations/:id/messages", (req, res) => {
  const { id } = req.params;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const limit = Math.min(Number(req.query.limit || 50) || 50, 100);
  const after = req.query.after ? String(req.query.after) : null;

  const db = ensureDbShape(loadDB());

  // (Opcional) se você quiser bloquear leitura quando WebChat desativado:
  // const allow = assertWebchatAllowed(db, req);
  // if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  const all = Array.isArray(db.messagesByConversation?.[String(id)])
    ? db.messagesByConversation[String(id)]
    : [];

  let items = all;

  if (after) {
    const idx = all.findIndex((m) => String(m.id) === String(after));
    if (idx >= 0) items = all.slice(idx + 1);
    else items = all.filter((m) => String(m.createdAt || "") > after);
  }

  items = items.slice(0, limit);

  const last = items.length ? items[items.length - 1] : null;
  const nextCursor = last ? (last.id || last.createdAt) : after || null;

  return res.json({ items, nextCursor });
});

// ----------------------------------------------------
// POST /webchat/messages
// Visitor envia mensagem
// ----------------------------------------------------
router.post("/messages", async (req, res) => {
  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  const { conversationId, source } = decoded || {};
  const { text } = req.body || {};

  if (!conversationId) return res.status(400).json({ error: "conversationId ausente no token" });
  if (source && source !== "webchat") return res.status(403).json({ error: "Token não é de Webchat" });

  const cleanText = String(text || "").trim();
  if (!cleanText) return res.status(400).json({ error: "Mensagem vazia" });

  const db = ensureDbShape(loadDB());

  // ✅ Respeitar canal ativo (se quiser bloquear envio quando desativado)
  const allow = assertWebchatAllowed(db, req);
  if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  const conv = getConversationOr404(db, conversationId);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }
  if (String(conv.status) !== "open") return res.status(410).json({ error: "Conversa encerrada" });

  // ✅ persiste via CORE oficial
  const result = appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "text",
    from: "client",
    direction: "in",
    text: cleanText,
    createdAt: nowIso()
  });

  if (!result?.ok) return res.status(400).json({ error: result?.error || "Falha ao salvar mensagem" });

  // ✅ Chatbot no WebChat (se habilitado e sem competição com humano)
  const bot = await maybeReplyWithBot(db, conv, cleanText);
  if (!bot?.ok) return res.status(500).json({ error: bot?.error || "Falha no bot" });

  saveDB(db);

  // Retorna ok + cursor + (opcional) botMessage para reduzir “latência” do polling
  return res.json({
    ok: true,
    message: result.msg,
    nextCursor: result.msg.id,
    bot: bot.didBot ? { message: bot.botMessage } : null
  });
});

// ----------------------------------------------------
// POST /webchat/conversations/:id/close
// Fecha a conversa (usado pelo X do widget)
// Aceita token em Authorization/x-webchat-token/?token=...
// ----------------------------------------------------
router.post("/conversations/:id/close", (req, res) => {
  const { id } = req.params;

  let decoded;
  try {
    decoded = verifyWebchatToken(req);
  } catch (e) {
    return res.status(401).json({ error: e.message || "Token inválido" });
  }

  if (decoded?.conversationId && String(decoded.conversationId) !== String(id)) {
    return res.status(403).json({ error: "Token não pertence à conversa" });
  }

  const db = ensureDbShape(loadDB());

  // (Opcional) permitir fechar mesmo se canal desativado — normalmente sim
  // const allow = assertWebchatAllowed(db, req);
  // if (!allow.ok) return res.status(allow.status).json({ error: allow.error, details: allow.details });

  const conv = getConversationOr404(db, id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });

  if (String(conv.source || "") !== "webchat") {
    return res.status(409).json({ error: "Conversa não pertence ao Webchat" });
  }

  if (String(conv.status) === "closed") {
    return res.json({ ok: true, status: "closed" });
  }

  conv.status = "closed";
  conv.closedAt = nowIso();
  conv.closedReason = "webchat_widget_close";
  conv.updatedAt = nowIso();

  // (Opcional) registrar mensagem system de encerramento
  appendMessage(db, conv.id, {
    channel: "webchat",
    source: "webchat",
    type: "system",
    from: "system",
    direction: "out",
    text: "Conversa encerrada.",
    createdAt: nowIso()
  });

  saveDB(db);
  return res.json({ ok: true, status: "closed" });
});

export default router;
