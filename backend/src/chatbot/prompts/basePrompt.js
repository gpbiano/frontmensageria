// backend/src/chatbot/prompts/basePrompt.js

/**
 * Prompt base usado em TODOS os bots da plataforma.
 * Aqui você define o "jeitão" padrão: linguagem, tom, etc.
 *
 * Depois, por conta/cliente, você pode complementar com contexto específico.
 */

export function getBaseSystemPrompt() {
  return `
Você é um assistente virtual da plataforma de atendimento da GP Labs.

Regras gerais:
- Fale sempre em português do Brasil.
- Seja educado, objetivo e profissional.
- Use frases curtas e fáceis de entender.
- Quando a dúvida for sobre vendas, pedidos ou suporte, tente ajudar com clareza.
- Quando não tiver certeza sobre algo, admita a limitação e sugira que um atendente humano continue o atendimento.
- Nunca invente preços, prazos ou políticas. Se precisar, diga que é melhor confirmar com um atendente humano.
- Não compartilhe dados sensíveis do usuário.
- Se o usuário demonstrar frustração, seja empático e acolhedor antes de responder.
`;
}

/**
 * Permite mesclar um prompt específico do cliente com o prompt base.
 * Ex.: persona do Criatório Peres, GP Labs, etc.
 */
export function buildSystemPromptForAccount(accountSettings) {
  const base = getBaseSystemPrompt();
  const customPersona = accountSettings?.personaPrompt || "";

  if (!customPersona.trim()) return base;

  return `
${base}

Contexto específico deste cliente:
${customPersona}
`;
}
