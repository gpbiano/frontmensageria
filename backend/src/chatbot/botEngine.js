// backend/src/chatbot/botEngine.js
import OpenAI from "openai";
import logger from "../logger.js";

export async function callGenAIBot({
  accountSettings,
  conversation,
  messageText,
  history
}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    logger.error(
      { hasKey: !!apiKey },
      "❌ [BOT ENGINE] OPENAI_API_KEY não definido."
    );
    return { replyText: "Desculpe, tive um problema interno." };
  }

  const client = new OpenAI({ apiKey });

  // ===============================
  // MONTA O SYSTEM PROMPT
  // ===============================
  const baseSystemPrompt =
    "Você é um assistente virtual profissional da GP Labs. Seja educado, objetivo, útil e escreva em português do Brasil.";

  // Campos opcionais vindos da aba Chatbot
  const maestro =
    accountSettings?.systemPrompt ||
    accountSettings?.promptMaestro ||
    accountSettings?.prompt_maestro ||
    "";
  const personaSnippet =
    accountSettings?.personaSnippet ||
    accountSettings?.persona_snippet ||
    accountSettings?.voice_custom ||
    "";

  const systemParts = [baseSystemPrompt];
  if (maestro) systemParts.push(maestro);
  if (personaSnippet) systemParts.push(personaSnippet);

  const finalSystemPrompt = systemParts.join("\n\n");

  // ===============================
  // LOG DE ENTRADA
  // ===============================
  logger.info(
    {
      conversationId: conversation?.id || null,
      model,
      historyCount: Array.isArray(history) ? history.length : 0
    },
    "🤖 [BOT ENGINE] Chamando GenAI"
  );

  try {
    const messages = [
      {
        role: "system",
        content: finalSystemPrompt
      },
      ...(history || []),
      {
        role: "user",
        content: messageText
      }
    ];

    const completion = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.4,
      max_tokens: 200
    });

    const reply =
      completion?.choices?.[0]?.message?.content?.trim() ||
      "Desculpe, não consegui entender. Pode repetir?";

    logger.info(
      {
        conversationId: conversation?.id || null,
        replyPreview: reply.slice(0, 120)
      },
      "🤖 [BOT ENGINE] Resposta gerada com sucesso"
    );

    // index.js é quem persiste a mensagem e marca fromBot/isBot
    return {
      replyText: reply
    };
  } catch (err) {
    logger.error(
      {
        err: err?.response?.data || err,
        conversationId: conversation?.id || null
      },
      "❌ [BOT ENGINE] Erro na chamada OpenAI"
    );

    return {
      replyText: "Desculpe, ocorreu um erro interno."
    };
  }
}
