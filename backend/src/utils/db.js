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

const DEFAULT_TAGS = ["Vendas", "Suporte", "Reclamação", "Financeiro"];

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
      tags: DEFAULT_TAGS,
      channels: {} // ✅ preparado pro módulo de canais
    },
    outboundCampaigns: []
  };
}

function ensureObject(v, fallback = {}) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
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

    parsed.messagesByConversation = ensureObject(parsed.messagesByConversation, {});

    // ✅ settings: mantém o que existe, mas garante defaults sem sobrescrever
    parsed.settings = ensureObject(parsed.settings, {});
    parsed.settings.tags = ensureArray(parsed.settings.tags);
    if (!parsed.settings.tags.length) parsed.settings.tags = DEFAULT_TAGS;

    parsed.settings.channels = ensureObject(parsed.settings.channels, {}); // ✅ não quebra canais

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
