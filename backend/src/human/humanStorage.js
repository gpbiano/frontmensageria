// backend/src/human/humanStorage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Arquivo específico do módulo Human
const HUMAN_DB_FILE = path.join(process.cwd(), "human-data.json");

/**
 * Garante que o arquivo human-data.json exista
 * com a estrutura base esperada.
 */
function ensureFileExists() {
  if (!fs.existsSync(HUMAN_DB_FILE)) {
    const initial = {
      sessions: [],
      actions: []
    };

    fs.writeFileSync(HUMAN_DB_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

/**
 * Carrega o estado completo do módulo humano.
 */
export function loadHumanState() {
  try {
    ensureFileExists();
    const raw = fs.readFileSync(HUMAN_DB_FILE, "utf8");
    const parsed = JSON.parse(raw);

    if (!parsed.sessions) parsed.sessions = [];
    if (!parsed.actions) parsed.actions = [];

    return parsed;
  } catch (err) {
    console.error("❌ Erro ao carregar human-data.json", err);
    return {
      sessions: [],
      actions: []
    };
  }
}

/**
 * Salva o estado completo do módulo humano.
 */
export function saveHumanState(state) {
  try {
    const toSave = {
      sessions: state.sessions || [],
      actions: state.actions || []
    };

    fs.writeFileSync(
      HUMAN_DB_FILE,
      JSON.stringify(toSave, null, 2),
      "utf8"
    );
  } catch (err) {
    console.error("❌ Erro ao salvar human-data.json", err);
  }
}

/**
 * Helper para atualizar o estado com uma função de mutação.
 * Ex:
 *   updateHumanState((state) => {
 *     state.sessions.push(...);
 *   });
 */
export function updateHumanState(mutatorFn) {
  const state = loadHumanState();
  mutatorFn(state);
  saveHumanState(state);
  return state;
}
