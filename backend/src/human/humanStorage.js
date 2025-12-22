// backend/src/human/humanStorage.js
// ✅ PRISMA-FIRST (SEM human-data.json)
// Este módulo era legado e persistia estado do "human" em human-data.json.
// Agora o projeto é Prisma-first. Mantemos as funções para não quebrar imports antigos,
// porém SEM escrever em disco. Se algum fluxo ainda depender desse estado, ele precisa
// ser migrado para Prisma (Conversation/Message/GroupMember/etc).

import logger from "../logger.js";

/**
 * Carrega estado legado do módulo humano.
 * ✅ Agora não existe mais storage local.
 * Retornamos um estado vazio para compatibilidade.
 */
export function loadHumanState() {
  logger.warn(
    "⚠️ humanStorage.loadHumanState chamado, mas human-data.json foi desativado (Prisma-first)."
  );
  return { sessions: [], actions: [] };
}

/**
 * Salva estado legado do módulo humano.
 * ✅ noop intencional para impedir gravação em disco.
 */
export function saveHumanState(_state) {
  logger.warn(
    "⚠️ humanStorage.saveHumanState chamado, mas human-data.json foi desativado (Prisma-first)."
  );
  return true;
}

/**
 * Helper legado que mutava estado em memória e persistia em JSON.
 * ✅ Agora apenas executa o mutator em um estado vazio e devolve.
 * Se algum código depender disso para funcionar, esse código precisa migrar para Prisma.
 */
export function updateHumanState(mutatorFn) {
  logger.warn(
    "⚠️ humanStorage.updateHumanState chamado, mas human-data.json foi desativado (Prisma-first)."
  );

  const state = { sessions: [], actions: [] };

  try {
    if (typeof mutatorFn === "function") mutatorFn(state);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ humanStorage.updateHumanState mutator falhou");
  }

  return state;
}
