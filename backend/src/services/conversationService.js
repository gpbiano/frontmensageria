// backend/src/services/conversationService.js
// ✅ SHIM / COMPAT (PRISMA-FIRST)
// Este arquivo existia no legado com data.json (messagesByConversation).
// Agora ele redireciona para o core Prisma-first em src/routes/conversations.js
// para evitar qualquer risco de perda/estado fora do banco.

import logger from "../logger.js";

// Core Prisma-first (exports nomeados)
let __core = null;

async function getCore() {
  if (__core) return __core;

  try {
    // ✅ resolve caminho de forma segura no ESM
    const mod = await import(new URL("../routes/conversations.js", import.meta.url).href);

    const getOrCreateChannelConversation =
      mod?.getOrCreateChannelConversation || mod?.default?.getOrCreateChannelConversation;

    const appendMessage = mod?.appendMessage || mod?.default?.appendMessage;

    if (typeof getOrCreateChannelConversation !== "function") {
      throw new Error(
        "conversations core: export getOrCreateChannelConversation não encontrado em src/routes/conversations.js"
      );
    }

    if (typeof appendMessage !== "function") {
      throw new Error(
        "conversations core: export appendMessage não encontrado em src/routes/conversations.js"
      );
    }

    __core = { getOrCreateChannelConversation, appendMessage };
    return __core;
  } catch (err) {
    logger.error(
      { err: err?.message || err },
      "❌ conversationService: falha ao carregar core Prisma-first (src/routes/conversations.js)"
    );
    throw err;
  }
}

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Compat: alguns lugares antigos chamavam:
 *   getOrCreateChannelConversation(db, payload)
 * ou:
 *   getOrCreateChannelConversation(payload)
 *
 * Agora ignoramos `db` e usamos somente `payload`.
 */
export async function getOrCreateChannelConversation(dbOrPayload, maybePayload) {
  const { getOrCreateChannelConversation } = await getCore();

  const payload = (maybePayload ?? dbOrPayload) || {};
  if (!isPlainObject(payload)) {
    return { ok: false, error: "payload inválido (esperado objeto)" };
  }

  // ✅ core atual aceita (payload) — sem db
  return getOrCreateChannelConversation(payload);
}

/**
 * Compat: alguns lugares antigos chamavam:
 *   appendMessage(db, conversationId, rawMsg)
 * ou:
 *   appendMessage(conversationId, rawMsg)
 *
 * Agora ignoramos `db` e escrevemos no Prisma.
 */
export async function appendMessage(dbOrConversationId, conversationIdOrRaw, maybeRaw) {
  const { appendMessage } = await getCore();

  // detecta assinatura antiga
  const conversationId =
    typeof dbOrConversationId === "string"
      ? dbOrConversationId
      : String(conversationIdOrRaw || "").trim();

  const rawMsg = typeof dbOrConversationId === "string" ? conversationIdOrRaw : maybeRaw;

  if (!conversationId) {
    return { ok: false, error: "conversationId obrigatório" };
  }

  // ✅ core atual aceita (conversationId, rawMsg)
  return appendMessage(conversationId, rawMsg || {});
}

/**
 * ⚠️ Se alguém ainda tentar usar "db shape" antigo, não deixamos passar em silêncio.
 * Isso evita voltar sem querer para memória/data.json.
 */
export function ensureDbShape() {
  // noop intencional: não existe mais storage legado
  return {};
}
