// backend/src/utils/db.js
// LEGACY DB KILLER — encerra data.json definitivamente

import logger from "../logger.js";

export function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * ⚠️ Data.json desativado por migração Prisma-first.
 * Se alguma rota ainda chamar loadDB/saveDB, vamos falhar explícito
 * para localizar e remover o uso.
 */
function legacyDisabledError(fnName) {
  const err = new Error(
    `LEGACY_DB_DISABLED: ${fnName}() foi chamado, mas data.json está desativado. Migre para Prisma.`
  );
  // loga stack pra achar arquivo/linha rapidamente
  logger.error({ err: err.stack }, "❌ Tentativa de uso do legado data.json");
  return err;
}

export function loadDB() {
  throw legacyDisabledError("loadDB");
}

export function saveDB() {
  throw legacyDisabledError("saveDB");
}
