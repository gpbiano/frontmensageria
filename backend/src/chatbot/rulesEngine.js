// backend/src/chatbot/rulesEngine.js

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

function ensureAccount(accountId = "default") {
  const id = String(accountId || "default").trim() || "default";
  if (!accounts[id]) {
    accounts[id] = {
      enabled: true,
      maxBotAttempts: 3,
      transferKeywords: []
    };
  }
  return accounts[id];
}

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeAccountSettings(s) {
  const obj = s && typeof s === "object" ? s : {};
  const transferKeywords = safeArr(obj.transferKeywords)
    .map((k) => safeStr(k).toLowerCase())
    .filter(Boolean);

  const maxBotAttempts = Number.isFinite(Number(obj.maxBotAttempts))
    ? Math.max(0, Number(obj.maxBotAttempts))
    : 3;

  return {
    enabled: obj.enabled === true,
    maxBotAttempts,
    transferKeywords
  };
}

export function getChatbotSettingsForAccount(accountId = "default") {
  // ✅ garante sempre um objeto existente
  const base = ensureAccount(accountId);
  // ✅ normaliza para evitar campos faltando/errados
  return (accounts[String(accountId || "default").trim() || "default"] = {
    ...base,
    ...normalizeAccountSettings(base)
  });
}

/**
 * Lógica que decide se a conversa vai para BOT ou HUMANO
 * ✅ NULL-SAFE: nunca quebra se vier accountSettings/conversation/messageText undefined
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  const settings = normalizeAccountSettings(accountSettings || accounts.default || {});
  const conv = conversation && typeof conversation === "object" ? conversation : {};
  const text = safeStr(messageText, "");
  const lower = text.toLowerCase();

  // ✅ se bot desligado (ou settings ausentes), vai pro humano sem quebrar
  if (!settings.enabled) {
    return { target: "human", reason: "chatbot_disabled_or_missing_settings" };
  }

  // palavras-chave que pedem HUMANO
  if (lower && settings.transferKeywords.some((k) => k && lower.includes(k))) {
    return { target: "human", reason: "keyword_detected" };
  }

  // limite de tentativas do bot (fallback 0)
  const botAttempts = Number.isFinite(Number(conv.botAttempts)) ? Number(conv.botAttempts) : 0;
  if (botAttempts >= settings.maxBotAttempts) {
    return { target: "human", reason: "max_bot_attempts_reached" };
  }

  return { target: "bot", reason: "normal_bot_flow" };
}
