import OpenAI from "openai";

export async function callGenAIBot({
  accountSettings,
  conversation,
  messageText,
  history
}) {
  if (!process.env.OPENAI_API_KEY) {
    console.error("[BOT ENGINE] ❌ OPENAI_API_KEY não definido.");
    return { replyText: "Desculpe, tive um problema interno." };
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  try {
    const messages = [
      {
        role: "system",
        content:
          "Você é um assistente virtual profissional da GP Labs. Seja educado, objetivo e útil."
      },
      ...history,
      {
        role: "user",
        content: messageText
      }
    ];

    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages,
      temperature: 0.4,
      max_tokens: 200
    });

    const reply =
      completion?.choices?.[0]?.message?.content ||
      "Desculpe, não consegui entender. Pode repetir?";

    return { replyText: reply };
  } catch (err) {
    console.error("[BOT ENGINE] Erro na OpenAI:", err.response?.data || err);
    return { replyText: "Desculpe, ocorreu um erro interno." };
  }
}
