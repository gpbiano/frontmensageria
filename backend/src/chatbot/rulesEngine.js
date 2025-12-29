// backend/src/chatbot/rulesEngine.js

/**
 * Rules Engine (in-memory)
 * - Cada "account" tem settings do bot.
 * - Routers passam accountSettings como CONTEXTO (tenantId/channel/etc).
 *   Então: só considera overrides se vier em accountSettings.chatbot (ou accountSettings.settings).
 */

const accounts = {
  default: {
    enabled: true,
    maxBotAttempts: 3,
    transferKeywords: [
      "humano",
      "atendente",
      "pessoa",
      "falar com alguém",
      "falar com alguem",
      "falar com humano",
      "quero humano",
      "suporte",
      "atendimento"
    ]
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
 * ✅ Export esperado pelo chatbotRouter.js
 */
export function getChatbotSettingsForAccount(accountId = "default") {
  const id = safeStr(accountId, "default") || "default";
  const base = ensureAccount(id);
  const normalized = normalizeAccountSettings(base);
  accounts[id] = { ...base, ...normalized };
  return accounts[id];
}

/**
 * Decide rota BOT vs HUMANO
 *
 * IMPORTANTE:
 * - accountSettings aqui é CONTEXTO (tenantId/channel/instagramBusinessId...)
 * - settings (enabled/maxBotAttempts/transferKeywords) vêm de:
 *    1) getChatbotSettingsForAccount(accountId)
 *    2) override opcional em accountSettings.chatbot (ou accountSettings.settings)
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  const accId =
    safeStr(accountSettings?.accountId) ||
    safeStr(accountSettings?.id) ||
    safeStr(accountSettings?.tenantId) || // ✅ teu caso atual
    "default";

  const baseSettings = normalizeAccountSettings(getChatbotSettingsForAccount(accId));

  // override opcional (se um dia quiser custom por tenant/channel sem mexer nos routers)
  const overrideRaw =
    accountSettings?.chatbot && typeof accountSettings.chatbot === "object"
      ? accountSettings.chatbot
      : accountSettings?.settings && typeof accountSettings.settings === "object"
        ? accountSettings.settings
        : null;

  const overrideSettings = overrideRaw ? normalizeAccountSettings(overrideRaw) : null;

  // merge: base + override (override só sobrescreve se vier definido)
  const settings = overrideSettings
    ? {
        enabled:
          typeof overrideRaw.enabled === "boolean" ? overrideSettings.enabled : baseSettings.enabled,
        maxBotAttempts:
          Number.isFinite(Number(overrideRaw.maxBotAttempts))
            ? overrideSettings.maxBotAttempts
            : baseSettings.maxBotAttempts,
        transferKeywords:
          Array.isArray(overrideRaw.transferKeywords) && overrideSettings.transferKeywords.length
            ? overrideSettings.transferKeywords
            : baseSettings.transferKeywords
      }
    : baseSettings;

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
