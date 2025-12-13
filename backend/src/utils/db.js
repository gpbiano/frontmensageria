// backend/src/utils/db.js
import fs from "fs";
import path from "path";

/**
 * Caminho ÚNICO do banco
 * - Prioriza env DB_FILE
 * - Cai sempre no mesmo data.json do projeto
 */
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(process.cwd(), "data.json");

/**
 * Garante array
 */
export function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Cria estrutura inicial se não existir
 */
function createInitialDb() {
  return {
    users: [],
    passwordTokens: [],
    contacts: [],
    conversations: [],
    messagesByConversation: {},
    settings: {
      tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"]
    },
    outboundCampaigns: []
  };
}

/**
 * Carrega DB do disco (sempre o mesmo arquivo)
 */
export function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = createInitialDb();
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw || "{}");

    // garante estrutura mínima
    parsed.users = ensureArray(parsed.users);
    parsed.passwordTokens = ensureArray(parsed.passwordTokens);
    parsed.contacts = ensureArray(parsed.contacts);
    parsed.conversations = ensureArray(parsed.conversations);
    parsed.messagesByConversation =
      parsed.messagesByConversation && typeof parsed.messagesByConversation === "object"
        ? parsed.messagesByConversation
        : {};
    parsed.settings =
      parsed.settings && typeof parsed.settings === "object"
        ? parsed.settings
        : { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
    parsed.outboundCampaigns = ensureArray(parsed.outboundCampaigns);

    return parsed;
  } catch (err) {
    console.error("❌ Erro ao carregar DB:", err);
    return createInitialDb();
  }
}

/**
 * Salva DB no disco
 */
export function saveDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
  } catch (err) {
    console.error("❌ Erro ao salvar DB:", err);
  }
}
