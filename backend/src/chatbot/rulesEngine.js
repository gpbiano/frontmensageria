// backend/src/chatbot/rulesEngine.js

/**
 * Configuração única por enquanto — no futuro pode haver contas diferentes
 */
const accounts = {
  default: {
    enabled: true,
    maxBotAttempts: 3,
    transferKeywords: ["humano", "atendente", "pessoa", "falar com alguém", "falar com uma pessoa"]
  }
};

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}
function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeSettings(base = {}, override = {}) {
  const b = base && typeof base === "object" ? base : {};
  const o = override && typeof override === "object" ? override : {};

  const transferKeywords = [
    ...safeArr(b.transferKeywords),
    ...safeArr(o.transferKeywords)
  ]
    .map((k) => safeStr(k).toLowerCase())
    .filter(Boolean);

  const maxBotAttemptsRaw = o.maxBotAttempts ?? b.maxBotAttempts ?? 3;
  const maxBotAttempts = Number.isFinite(Number(maxBotAttemptsRaw))
    ? Math.max(0, Number(maxBotAttemptsRaw))
    : 3;

  // ✅ default TRUE (só desliga se explicitamente false)
  const enabled = (o.enabled ?? b.enabled) !== false;

  return { enabled, maxBotAttempts, transferKeywords };
}

/**
 * Lógica que decide se a conversa vai para BOT ou HUMANO
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  // ✅ sempre parte do default
  const settings = normalizeSettings(accounts.default, accountSettings);

  const conv = conversation && typeof conversation === "object" ? conversation : {};
  const text = safeStr(messageText, "");
  const lower = text.toLowerCase();

  if (!settings.enabled) {
    return { target: "human", reason: "chatbot_disabled_or_missing_settings" };
  }

  if (lower && settings.transferKeywords.some((k) => k && lower.includes(k))) {
    return { target: "human", reason: "keyword_detected" };
  }

  const botAttempts = Number.isFinite(Number(conv.botAttempts)) ? Number(conv.botAttempts) : 0;
  if (botAttempts >= settings.maxBotAttempts) {
    return { target: "human", reason: "max_bot_attempts_reached" };
  }

  return { target: "bot", reason: "normal_bot_flow" };
}
