// backend/src/chatbot/botEngine.js
import OpenAI from "openai";
import logger from "../logger.js";

function safeStr(v) {
  if (typeof v === "string") return v.trim();
  if (v == null) return "";
  return String(v).trim();
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  // garante shape aceito pela OpenAI: {role, content:string}
  const out = [];
  for (const m of history) {
    const role = safeStr(m?.role).toLowerCase();
    const content = safeStr(m?.content);

    if (!role || !content) continue;
    if (role !== "system" && role !== "user" && role !== "assistant") continue;

    out.push({ role, content });
  }
  return out;
}

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

  const client = new OpenAI({ apiKey });

  // ✅ Se já está em atendimento humano, o bot NÃO responde
  if (safeStr(conversation?.currentMode).toLowerCase() === "human") {
    return { replyText: null, handoff: true };
  }

  // ✅ Se houve pedido explícito de humano (marcado na conversa), também não responde
  if (conversation?.handoffRequestedAt) {
    return { replyText: null, handoff: true };
  }

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

    // index.js/webhook é quem persiste a mensagem e marca fromBot/isBot
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
