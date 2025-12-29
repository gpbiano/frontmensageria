// backend/src/chatbot/rulesEngine.js

/**
 * Rules Engine (in-memory)
 * - Cada "account" (ex.: tenantId) tem settings do bot
 * - Se não existir settings para o account, ele herda o DEFAULT (inclusive keywords)
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

function cloneDefault() {
  const d = accounts.default || {};
  return {
    enabled: d.enabled !== false,
    maxBotAttempts: Number.isFinite(Number(d.maxBotAttempts)) ? Number(d.maxBotAttempts) : 3,
    transferKeywords: safeArr(d.transferKeywords).map((k) => safeStr(k))
  };
}

/**
 * ✅ IMPORTANTE: quando criar um account novo (tenantId), ele HERDA o default
 * senão keywords ficam vazias e nunca transfere.
 */
function ensureAccount(accountId = "default") {
  const id = safeStr(accountId, "default") || "default";
  if (!accounts[id]) {
    accounts[id] = cloneDefault();
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
 * accountSettings é CONTEXTO (tenantId/channel/instagramBusinessId...)
 * settings reais vêm do getChatbotSettingsForAccount(accountId)
 *
 * Override opcional: accountSettings.chatbot (ou accountSettings.settings)
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  const accId =
    safeStr(accountSettings?.accountId) ||
    safeStr(accountSettings?.id) ||
    safeStr(accountSettings?.tenantId) ||
    "default";

  // ✅ agora herda keywords do default ao criar tenant novo
  const baseSettings = normalizeAccountSettings(getChatbotSettingsForAccount(accId));

  const overrideRaw =
    accountSettings?.chatbot && typeof accountSettings.chatbot === "object"
      ? accountSettings.chatbot
      : accountSettings?.settings && typeof accountSettings.settings === "object"
        ? accountSettings.settings
        : null;

  const overrideSettings = overrideRaw ? normalizeAccountSettings(overrideRaw) : null;

  const settings = overrideSettings
    ? {
        enabled:
          typeof overrideRaw.enabled === "boolean" ? overrideSettings.enabled : baseSettings.enabled,
        maxBotAttempts:
          Number.isFinite(Number(overrideRaw.maxBotAttempts))
            ? overrideSettings.maxBotAttempts
            : baseSettings.maxBotAttempts,
        transferKeywords:
          Array.isArray(overrideRaw.transferKeywords)
            ? overrideSettings.transferKeywords
            : baseSettings.transferKeywords
      }
    : baseSettings;

  const conv = conversation && typeof conversation === "object" ? conversation : {};
  const text = safeStr(messageText, "");
  const lower = text.toLowerCase();

  // 🔎 debug opcional (ativa setando DEBUG_RULES_ENGINE=true no env)
  if (String(process.env.DEBUG_RULES_ENGINE || "").toLowerCase() === "true") {
    // eslint-disable-next-line no-console
    console.log("[rulesEngine] accId=", accId, "text=", lower, "keywords=", settings.transferKeywords);
  }

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
