// backend/src/human/humanHistory.js
import { randomUUID } from "crypto";
import { loadHumanState, updateHumanState } from "./humanStorage.js";

/**
 * Tipos aceitos para auditoria humana
 */
const ACTION_TYPES = new Set([
  "note",
  "takeover",
  "release",
  "tag_change",
  "status_change"
]);

function nowIso() {
  return new Date().toISOString();
}

function safeArray(v) {
  return Array.isArray(v) ? v : [];
}

function normalizeConvId(conversationId) {
  if (conversationId === undefined || conversationId === null) return "";
  return String(conversationId);
}

function normalizeType(type) {
  const t = String(type || "").trim().toLowerCase();
  return t;
}

/**
 * Lista todas as sessões humanas registradas.
 */
export function listHumanSessions() {
  const state = loadHumanState() || {};
  return safeArray(state.sessions);
}

/**
 * Lista todas as ações humanas registradas.
 */
export function listHumanActions() {
  const state = loadHumanState() || {};
  return safeArray(state.actions);
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
  const timestamp = nowIso();

  const convId = normalizeConvId(conversationId);
  if (!convId) {
    throw new Error("conversationId obrigatório");
  }

  const t = normalizeType(type);
  if (!t || !ACTION_TYPES.has(t)) {
    throw new Error(
      `type inválido. Use: ${Array.from(ACTION_TYPES).join("|")}`
    );
  }

  // compatibilidade legado
  const name = String(agentName || agent || "Atendente").trim() || "Atendente";
  const id = String(agentId || "unknown");
  const role = String(agentRole || "agent");

  const action = {
    id: randomUUID(),
    conversationId: convId,
    agentId: id,
    agentName: name,
    agentRole: role,
    type: t,
    note: typeof note === "string" ? note : String(note || ""),
    createdAt: timestamp
  };

  updateHumanState((stateRaw) => {
    const state = stateRaw || {};

    state.actions = safeArray(state.actions);
    state.sessions = safeArray(state.sessions);

    state.actions.push(action);

    let session = state.sessions.find((s) => String(s?.conversationId) === convId);

    if (!session) {
      session = {
        id: randomUUID(),
        conversationId: convId,

        // auditoria inicial
        firstAgentId: id !== "unknown" ? id : null,
        firstAgentName: name || null,
        firstAgentRole: role || null,

        createdAt: timestamp,
        updatedAt: timestamp,
        lastActionAt: timestamp,
        closedAt: null,

        // útil pra auditoria
        lastAgentId: id !== "unknown" ? id : null,
        lastAgentName: name || null,
        lastAgentRole: role || null,

        // campos opcionais
        closedById: null,
        closedByName: null,
        closedByRole: null
      };

      state.sessions.push(session);
    } else {
      session.lastActionAt = timestamp;
      session.updatedAt = timestamp;

      // mantém o primeiro agente (se não existia)
      if (!session.firstAgentName && name) session.firstAgentName = name;
      if (!session.firstAgentId && id !== "unknown") session.firstAgentId = id;
      if (!session.firstAgentRole && role) session.firstAgentRole = role;

      // atualiza "último agente" sempre
      if (id !== "unknown") session.lastAgentId = id;
      if (name) session.lastAgentName = name;
      if (role) session.lastAgentRole = role;
    }

    return state;
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
  const convId = normalizeConvId(conversationId);
  if (!convId) throw new Error("conversationId obrigatório");

  updateHumanState((stateRaw) => {
    const state = stateRaw || {};
    state.sessions = safeArray(state.sessions);

    const session = state.sessions.find((s) => String(s?.conversationId) === convId);
    if (!session) return state;

    // se já estiver fechada, só retorna a sessão sem alterar o closedAt
    const closedAt = session.closedAt || nowIso();
    session.closedAt = closedAt;
    session.lastActionAt = closedAt;
    session.updatedAt = closedAt;

    if (closedBy && typeof closedBy === "object") {
      session.closedById = closedBy.closedById || session.closedById || null;
      session.closedByName = closedBy.closedByName || session.closedByName || null;
      session.closedByRole = closedBy.closedByRole || session.closedByRole || null;
    }

    updatedSession = session;
    return state;
  });

  return updatedSession;
}
