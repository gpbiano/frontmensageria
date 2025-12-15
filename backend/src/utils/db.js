// backend/src/utils/db.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Resolve paths sempre a partir do diretório "backend/"
 * (independente do process.cwd())
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// db.js está em: backend/src/utils/db.js
// então backendRoot = backend/
const BACKEND_ROOT = path.resolve(__dirname, "..", "..");

/**
 * Caminho ÚNICO do banco
 * - Se DB_FILE existir:
 *    - se for absoluto, usa como está
 *    - se for relativo, resolve relativo ao BACKEND_ROOT
 * - Caso contrário: backend/data.json
 */
const DB_FILE = (() => {
  const envPath = process.env.DB_FILE && String(process.env.DB_FILE).trim();
  if (envPath) {
    return path.isAbsolute(envPath)
      ? envPath
      : path.resolve(BACKEND_ROOT, envPath);
  }
  return path.join(BACKEND_ROOT, "data.json");
})();

/**
 * (Opcional) ajuda MUITO a debugar:
 * você vai ver exatamente qual arquivo está sendo usado.
 */
console.log("🗄️ [DB] Using DB_FILE:", DB_FILE);

/**
 * Garante array
 */
export function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

const DEFAULT_TAGS = ["Vendas", "Suporte", "Reclamação", "Financeiro"];

function ensureObject(v, fallback = {}) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : fallback;
}

/**
 * Estrutura inicial
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
      channels: {}
    },
    outboundCampaigns: []
  };
}

/**
 * Carrega DB do disco
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

    parsed.users = ensureArray(parsed.users);
    parsed.passwordTokens = ensureArray(parsed.passwordTokens);
    parsed.contacts = ensureArray(parsed.contacts);
    parsed.conversations = ensureArray(parsed.conversations);

    parsed.messagesByConversation = ensureObject(parsed.messagesByConversation, {});

    parsed.settings = ensureObject(parsed.settings, {});
    parsed.settings.tags = ensureArray(parsed.settings.tags);
    if (!parsed.settings.tags.length) parsed.settings.tags = DEFAULT_TAGS;

    parsed.settings.channels = ensureObject(parsed.settings.channels, {});

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