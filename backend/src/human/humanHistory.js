// backend/src/human/humanHistory.js
import { randomUUID } from "crypto";
import { loadHumanState, updateHumanState } from "./humanStorage.js";

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
 * Payload (novo padrão – auditoria):
 * {
 *   conversationId: "conv_123" | 123,
 *   agentId: "usr_123",
 *   agentName: "Genivaldo Peres",
 *   agentRole: "agent|manager|admin",
 *   type: "note|takeover|release|tag_change|status_change",
 *   note: "texto opcional"
 * }
 *
 * Compatibilidade (legado):
 * - se vier "agent" (string), usamos como agentName
 */
export function logHumanAction({
  conversationId,
  agentId,
  agentName,
  agentRole,
  agent, // legado
  type,
  note
}) {
  const timestamp = new Date().toISOString();

  // ✅ conversa pode ser string/number ("conv_123" ou 123)
  const convId = String(conversationId);

  // ✅ compatibilidade com legado
  const name = agentName || agent || "Atendente";
  const id = agentId || "unknown";
  const role = agentRole || "agent";

  const action = {
    id: randomUUID(),
    conversationId: convId,
    agentId: id,
    agentName: name,
    agentRole: role,
    type,
    note: note || "",
    createdAt: timestamp
  };

  updateHumanState((state) => {
    if (!state.actions) state.actions = [];
    state.actions.push(action);

    // cria/atualiza sessão vinculada
    if (!state.sessions) state.sessions = [];

    let session = state.sessions.find((s) => String(s.conversationId) === convId);

    if (!session) {
      session = {
        id: randomUUID(),
        conversationId: convId,

        // ✅ auditoria inicial
        firstAgentId: id !== "unknown" ? id : null,
        firstAgentName: name || null,
        firstAgentRole: role || null,

        createdAt: timestamp,
        lastActionAt: timestamp,
        closedAt: null,

        // ✅ útil pra auditoria
        lastAgentId: id !== "unknown" ? id : null,
        lastAgentName: name || null,
        lastAgentRole: role || null
      };
      state.sessions.push(session);
    } else {
      session.lastActionAt = timestamp;

      // mantém o primeiro agente (se não existia)
      if (!session.firstAgentName && name) {
        session.firstAgentName = name;
      }
      if (!session.firstAgentId && id !== "unknown") {
        session.firstAgentId = id;
      }
      if (!session.firstAgentRole && role) {
        session.firstAgentRole = role;
      }

      // atualiza "último agente" sempre
      if (id !== "unknown") session.lastAgentId = id;
      if (name) session.lastAgentName = name;
      if (role) session.lastAgentRole = role;
    }
  });

  return action;
}

/**
 * Marca uma sessão como encerrada (closedAt preenchido).
 *
 * Agora aceita opcionalmente quem encerrou (auditoria):
 * closeHumanSession(conversationId, { closedById, closedByName, closedByRole })
 */
export function closeHumanSession(conversationId, closedBy) {
  let updatedSession = null;
  const convId = String(conversationId);

  updateHumanState((state) => {
    if (!state.sessions) state.sessions = [];

    const session = state.sessions.find((s) => String(s.conversationId) === convId);
    if (!session) return;

    session.closedAt = new Date().toISOString();
    session.lastActionAt = session.closedAt;

    if (closedBy && typeof closedBy === "object") {
      session.closedById = closedBy.closedById || session.closedById || null;
      session.closedByName = closedBy.closedByName || session.closedByName || null;
      session.closedByRole = closedBy.closedByRole || session.closedByRole || null;
    }

    updatedSession = session;
  });

  return updatedSession;
}
