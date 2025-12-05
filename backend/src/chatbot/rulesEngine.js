/**
 * Configuração única por enquanto — no futuro pode haver contas diferentes
 */
const accounts = {
  default: {
    enabled: true,
    maxBotAttempts: 3,
    transferKeywords: ["humano", "atendente", "pessoa", "falar com alguém"]
  }
};

export function getChatbotSettingsForAccount(accountId = "default") {
  if (!accounts[accountId]) {
    accounts[accountId] = {
      enabled: true,
      maxBotAttempts: 3,
      transferKeywords: []
    };
  }
  return accounts[accountId];
}

/**
 * Lógica que decide se a conversa vai para BOT ou HUMANO
 */
export function decideRoute({ accountSettings, conversation, messageText }) {
  if (!accountSettings.enabled) {
    return { target: "human", reason: "chatbot_disabled" };
  }

  // palavras-chave que pedem HUMANO
  const lower = messageText.toLowerCase();
  if (accountSettings.transferKeywords.some(k => lower.includes(k))) {
    return { target: "human", reason: "keyword_detected" };
  }

  // limite de tentativas do bot
  if (conversation.botAttempts >= accountSettings.maxBotAttempts) {
    return { target: "human", reason: "max_bot_attempts_reached" };
  }

  return { target: "bot", reason: "normal_bot_flow" };
}
