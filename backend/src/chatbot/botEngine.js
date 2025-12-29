// backend/src/chatbot/botEngine.js
import OpenAI from "openai";
import logger from "../logger.js";

function safeStr(v) {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

/**
 * Histórico no formato "pronto para OpenAI": [{role, content}]
 * Aceita:
 *  - history já no formato OpenAI (role/content)
 *  - OU mensagens do DB do seu sistema (direction/text/type/metadata/from)
 */
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  const out = [];

  for (const m of history) {
    // Caso 1: já veio no shape OpenAI
    const role1 = safeStr(m?.role).toLowerCase();
    const content1 = safeStr(m?.content);
    if (role1 && content1 && (role1 === "system" || role1 === "user" || role1 === "assistant")) {
      out.push({ role: role1, content: content1 });
      continue;
    }

    // Caso 2: veio do DB (como no webchat.js: getLastMessagesForBot)
    const type = safeStr(m?.type || "text").toLowerCase();
    const text = safeStr(m?.text);

    // ignora mensagens vazias
    if (!text) continue;

    // m.direction geralmente é "in" / "out"
    const dir = safeStr(m?.direction).toLowerCase();

    // tenta inferir "from"
    const metaFrom = safeStr(m?.metadata?.from).toLowerCase();
    const from = safeStr(m?.from).toLowerCase() || metaFrom;

    let role = "user";

    // mensagens "system" viram system
    if (type === "system" || from === "system") {
      role = "system";
    } else if (from === "bot" || from === "assistant") {
      role = "assistant";
    } else if (from === "agent" || from === "human") {
      role = "assistant"; // agente humano aparece como "assistant" para contexto
    } else if (dir === "out") {
      role = "assistant";
    } else {
      role = "user";
    }

    out.push({ role, content: text });
  }

  // proteção: limita histórico para não explodir tokens (mantém final)
  const MAX = Math.min(Number(process.env.BOT_MAX_HISTORY || 12) || 12, 40);
  return out.length > MAX ? out.slice(out.length - MAX) : out;
}

function getConversationMode(conversation) {
  const cm =
    safeStr(conversation?.currentMode) ||
    safeStr(conversation?.metadata?.currentMode) ||
    "";
  return cm.toLowerCase();
}

/**
 * ======================================================
 * ✅ Função legada (MANTIDA) - não quebra nada existente
 * ======================================================
 */
export async function callGenAIBot({ accountSettings, conversation, messageText, history }) {
  const apiKey = safeStr(process.env.OPENAI_API_KEY);
  const model = safeStr(process.env.OPENAI_MODEL) || "gpt-4.1-mini";

  // ✅ Nunca chamar OpenAI sem texto válido
  const userText = safeStr(messageText);
  if (!userText) {
    logger.warn(
      { conversationId: conversation?.id || null },
      "⚠️ [BOT ENGINE] messageText vazio — ignorando"
    );
    return { replyText: null, skipped: true, reason: "empty_user_text" };
  }

  if (!apiKey) {
    logger.error({ hasKey: !!apiKey }, "❌ [BOT ENGINE] OPENAI_API_KEY não definido.");
    return { replyText: "Desculpe, tive um problema interno." };
  }

  // ✅ Se já está em atendimento humano, o bot NÃO responde
  if (getConversationMode(conversation) === "human") {
    return { replyText: null, handoff: true };
  }

  // ✅ Se houve pedido explícito de humano (marcado na conversa), também não responde
  if (conversation?.handoffRequestedAt) {
    return { replyText: null, handoff: true };
  }

  const client = new OpenAI({ apiKey });

  // ===============================
  // MONTA O SYSTEM PROMPT
  // ===============================
  const baseSystemPrompt =
    "Você é um assistente virtual profissional da GP Labs. Seja educado, objetivo, útil e escreva em português do Brasil.";

  // Campos opcionais vindos da aba Chatbot
  const maestro =
    safeStr(accountSettings?.systemPrompt) ||
    safeStr(accountSettings?.promptMaestro) ||
    safeStr(accountSettings?.prompt_maestro) ||
    "";

  const personaSnippet =
    safeStr(accountSettings?.personaSnippet) ||
    safeStr(accountSettings?.persona_snippet) ||
    safeStr(accountSettings?.voice_custom) ||
    "";

  const systemParts = [baseSystemPrompt];
  if (maestro) systemParts.push(maestro);
  if (personaSnippet) systemParts.push(personaSnippet);

  const finalSystemPrompt = systemParts.join("\n\n");

  // ===============================
  // LOG DE ENTRADA
  // ===============================
  const hist = normalizeHistory(history);

  logger.info(
    {
      conversationId: conversation?.id || null,
      model,
      historyCount: hist.length
    },
    "🤖 [BOT ENGINE] Chamando GenAI"
  );

  try {
    const messages = [
      { role: "system", content: finalSystemPrompt },
      ...hist,
      { role: "user", content: userText }
    ];

    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 200
    });

    const reply =
      safeStr(completion?.choices?.[0]?.message?.content) ||
      "Desculpe, não consegui entender. Pode repetir?";

    logger.info(
      {
        conversationId: conversation?.id || null,
        replyPreview: reply.slice(0, 120)
      },
      "🤖 [BOT ENGINE] Resposta gerada com sucesso"
    );

    return { replyText: reply };
  } catch (err) {
    logger.error(
      {
        err: err?.response?.data || err,
        conversationId: conversation?.id || null
      },
      "❌ [BOT ENGINE] Erro na chamada OpenAI"
    );

    return { replyText: "Desculpe, ocorreu um erro interno." };
  }
}

/**
 * ======================================================
 * ✅ Adapter compatível com o WebChat (NÃO quebra canais)
 * - webchat.js chama import("../chatbot/botEngine.js")
 *   e espera função OU objeto com run()
 * ======================================================
 *
 * ctx típico do webchat.js:
 * {
 *   channel: "webchat",
 *   conversation: convRow,
 *   userText: cleanText,
 *   messages: history
 * }
 *
 * Deve retornar STRING (reply do bot)
 */
export async function botEngine(ctx = {}) {
  const conversation = ctx?.conversation || {};
  const userText = safeStr(ctx?.userText || ctx?.messageText || ctx?.text || "");
  const history = ctx?.messages || ctx?.history || [];

  // accountSettings opcional (se algum caller já passar)
  const accountSettings = ctx?.accountSettings || ctx?.settings || null;

  const r = await callGenAIBot({
    accountSettings,
    conversation,
    messageText: userText,
    history
  });

  // WebChat espera string. Se for handoff/skip, devolve vazio.
  const reply = safeStr(r?.replyText || "");
  return reply || "";
}

// ✅ default export para o seu loader atual no webchat.js
export default botEngine;

// ✅ compat caso alguém trate como objeto com .run()
botEngine.run = async (ctx = {}) => botEngine(ctx);
