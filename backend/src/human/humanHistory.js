// backend/src/human/humanHistory.js
import { randomUUID } from "crypto";
import {
  loadHumanState,
  updateHumanState
} from "./humanStorage.js";

/**
 * Lista todas as sessões humanas registradas.
 */
export function listHumanSessions() {
  const state = loadHumanState();
  return state.sessions || [];
}

/**
 * Lista todas as ações humanas registradas.
 */
export function listHumanActions() {
  const state = loadHumanState();
  return state.actions || [];
}

/**
 * Registra uma nova ação de atendimento humano.
 *
 * Exemplo de payload:
 * {
 *   conversationId: 123,
 *   agent: "Genivaldo",
 *   type: "takeover",
 *   note: "Assumi o atendimento"
 * }
 */
export function logHumanAction({ conversationId, agent, type, note }) {
  const timestamp = new Date().toISOString();

  const action = {
    id: randomUUID(),
    conversationId: Number(conversationId),
    agent,
    type,
    note,
    createdAt: timestamp
  };

  updateHumanState((state) => {
    if (!state.actions) state.actions = [];
    state.actions.push(action);

    // cria/atualiza sessão vinculada
    if (!state.sessions) state.sessions = [];

    let session = state.sessions.find(
      (s) => s.conversationId === Number(conversationId)
    );

    if (!session) {
      session = {
        id: randomUUID(),
        conversationId: Number(conversationId),
        firstAgent: agent || null,
        createdAt: timestamp,
        lastActionAt: timestamp,
        closedAt: null
      };
      state.sessions.push(session);
    } else {
      session.lastActionAt = timestamp;
      if (!session.firstAgent && agent) {
        session.firstAgent = agent;
      }
    }
  });

  return action;
}

/**
 * Marca uma sessão como encerrada (closedAt preenchido).
 */
export function closeHumanSession(conversationId) {
  let updatedSession = null;

  updateHumanState((state) => {
    if (!state.sessions) state.sessions = [];

    const session = state.sessions.find(
      (s) => s.conversationId === Number(conversationId)
    );

    if (!session) return;

    session.closedAt = new Date().toISOString();
    session.lastActionAt = session.closedAt;
    updatedSession = session;
  });

  return updatedSession;
}
