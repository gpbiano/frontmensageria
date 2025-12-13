// backend/src/utils/db.js
import fs from "fs";
import path from "path";

// Mantém compatível com env DB_FILE e fallback data.json na raiz do projeto
export function getDbFilePath() {
  return process.env.DB_FILE
    ? path.resolve(process.cwd(), process.env.DB_FILE)
    : path.join(process.cwd(), "data.json");
}

export function loadDB() {
  const DB_FILE = getDbFilePath();

  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        users: [],
        passwordTokens: [],
        contacts: [],
        conversations: [],
        messagesByConversation: {},
        settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
        outboundCampaigns: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    // garante chaves básicas (evita undefined)
    if (!parsed.users) parsed.users = [];
    if (!Array.isArray(parsed.passwordTokens)) parsed.passwordTokens = [];
    if (!parsed.contacts) parsed.contacts = [];
    if (!parsed.conversations) parsed.conversations = [];
    if (!parsed.messagesByConversation) parsed.messagesByConversation = {};
    if (!parsed.settings)
      parsed.settings = { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
    if (!Array.isArray(parsed.outboundCampaigns)) parsed.outboundCampaigns = [];

    return parsed;
  } catch {
    // fallback seguro
    return {
      users: [],
      passwordTokens: [],
      contacts: [],
      conversations: [],
      messagesByConversation: {},
      settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
      outboundCampaigns: []
    };
  }
}

export function saveDB(data) {
  const DB_FILE = getDbFilePath();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf8");
}

/**
 * Helper opcional: garante um array em um campo.
 * Ex: ensureArray(db, "users")
 */
export function ensureArray(db, key) {
  if (!db[key] || !Array.isArray(db[key])) db[key] = [];
  return db[key];
}

