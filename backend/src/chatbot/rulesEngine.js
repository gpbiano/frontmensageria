// backend/src/chatbot/rulesEngine.js

/**
 * Regras simples (in-memory) por conta.
 * - enabled: liga/desliga bot
 * - maxBotAttempts: após N tentativas, manda para humano
 * - transferKeywords: palavras que pedem humano
 *
 * OBS: este módulo é stateless no DB. Se quiser persistir depois, plugamos ChannelConfig.
 */

const accounts = {
  default: {
    enabled: true,
    maxBotAttempts: 3,
    transferKeywords: ["humano", "atendente", "pessoa", "falar com alguém", "falar com humano"]
  }
};

function safeStr(v, fallback = "") {
  const s = typeof v === "string" ? v : v == null ? "" : String(v);
  return s.trim() || fallback;
}

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function ensureAccount(accountId = "default") {
  const id = safeStr(accountId, "default") || "default";
  if (!accounts[id]) {
    accounts[id] = {
      enabled: true,
      maxBotAttempts: 3,
      transferKeywords: []
    };
  }
  return accounts[id];
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
    enabled: obj.enabled !== false, // default TRUE
    maxBotAttempts,
    transferKeywords
  };
}

/**
 * ✅ Export que teu chatbotRouter.js espera.
 * Garante sempre um objeto válido e normalizado.
 */
export function getChatbotSettingsForAccount(accountId = "default") {
  const id = safeStr(accountId, "default") || "default";
  const base = ensureAccount(id);
  const normalized = normalizeAccountSettings(base);

  // mantém referência atualizada em memória
  accounts[id] = { ...base, ...normalized };
  return accounts[id];
}

/**
 * Decide rota BOT vs HUMANO
 * - Se settings desabilitado → humano
 * - Se palavra-chave → humano
 * - Se excedeu tentativas → humano
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  // aceita tanto accountSettings já vindo “pronto” quanto busca por accountId
  const accId =
    safeStr(accountSettings?.accountId) ||
    safeStr(accountSettings?.id) ||
    safeStr(accountSettings?.tenantId) || // fallback se você usar tenantId como chave
    "default";

  const settings =
    accountSettings && typeof accountSettings === "object"
      ? normalizeAccountSettings(accountSettings)
      : normalizeAccountSettings(getChatbotSettingsForAccount(accId));

  const conv = conversation && typeof conversation === "object" ? conversation : {};
  const text = safeStr(messageText, "");
  const lower = text.toLowerCase();

  if (!settings.enabled) {
    return { target: "human", reason: "chatbot_disabled" };
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
