// backend/src/chatbot/rulesEngine.js

/**
 * Configuração simples in-memory.
 * Pode evoluir para DB depois (por tenant/channel/account).
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

/**
 * Decide o "enabled" com fallback saudável:
 * - Se vier explicitamente false → false
 * - Se vier explicitamente true → true
 * - Se não vier → true (pra não derrubar o bot por falta de campo)
 */
function coerceEnabled(obj) {
  // prioridades (mais específico primeiro)
  const direct = obj?.enabled;
  if (direct === false) return false;
  if (direct === true) return true;

  const botEnabled = obj?.botEnabled;
  if (botEnabled === false) return false;
  if (botEnabled === true) return true;

  const cfgBotEnabled = obj?.config?.botEnabled;
  if (cfgBotEnabled === false) return false;
  if (cfgBotEnabled === true) return true;

  return true; // ✅ default
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
    enabled: coerceEnabled(obj),
    maxBotAttempts,
    transferKeywords
  };
}

/**
 * Permite configurar settings por conta "lógica".
 * Exemplos de accountKey (sugestões):
 * - "default"
 * - "instagram:17841478008289331"
 * - "messenger:903617036165446"
 * - "tenant:cmjf5y6zt0000qe7495ry0q7e"
 */
export function getChatbotSettingsForAccount(accountId = "default") {
  const base = ensureAccount(accountId);
  const normalized = normalizeAccountSettings(base);

  // mantém storage normalizado
  accounts[String(accountId || "default").trim() || "default"] = {
    ...base,
    ...normalized
  };

  return accounts[String(accountId || "default").trim() || "default"];
}

/**
 * Lógica que decide se a conversa vai para BOT ou HUMANO
 * NULL-SAFE: nunca quebra se vier undefined
 */
export function decideRoute({ accountSettings, conversation, messageText } = {}) {
  // accountSettings pode vir "incompleto" (como no webhook)
  // → default enabled=true para não forçar handoff
  const settings = normalizeAccountSettings(accountSettings || accounts.default || {});
  const conv = conversation && typeof conversation === "object" ? conversation : {};
  const text = safeStr(messageText, "");
  const lower = text.toLowerCase();

  // se conversa já está em humano/handoff, deixa o caller tratar — aqui só decide bot/human por regras
  if (!settings.enabled) {
    return { target: "human", reason: "chatbot_disabled" };
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
