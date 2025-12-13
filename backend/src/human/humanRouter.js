// backend/src/human/humanRouter.js
import express from "express";
import {
  listHumanSessions,
  listHumanActions,
  logHumanAction,
  closeHumanSession
} from "./humanHistory.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

/**
 * MÓDULO HUMAN
 * -------------
 * Rotas relacionadas ao atendimento humano.
 * Persistência em humanHistory.js / human-data.json
 */

/**
 * Helper padrão para identificar o usuário logado
 * (fonte única de verdade para auditoria)
 */
function getUserFromReq(req) {
  const u = req.user || {};
  return {
    id: u.id || u.userId || "unknown",
    name: u.name || u.fullName || u.email || "Atendente",
    role: u.role || "agent"
  };
}

// Ping simples
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Módulo de atendimento humano ativo."
  });
});

/**
 * GET /api/human/sessions
 * Lista sessões humanas registradas
 */
router.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const sessions = await listHumanSessions();
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/human/actions
 * Lista ações dos atendentes (log de auditoria)
 */
router.get("/actions", requireAuth, async (req, res, next) => {
  try {
    const actions = await listHumanActions();
    res.json(actions);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/human/actions
 * Registra uma ação de atendimento humano.
 *
 * body esperado:
 * {
 *   "conversationId": "conv_123",
 *   "type": "note|takeover|release|tag_change|status_change",
 *   "note": "texto opcional"
 * }
 *
 * ⚠️ IMPORTANTE:
 * O atendente NÃO vem mais do body.
 * Sempre usamos o usuário autenticado (req.user).
 */
router.post("/actions", requireAuth, async (req, res, next) => {
  try {
    const { conversationId, type, note } = req.body || {};

    if (!conversationId || !type) {
      return res.status(400).json({
        error: "conversationId e type são obrigatórios."
      });
    }

    const me = getUserFromReq(req);

    const action = await logHumanAction({
      conversationId,
      agentId: me.id,
      agentName: me.name,
      agentRole: me.role,
      type,
      note: note || ""
    });

    res.status(201).json(action);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/human/:conversationId/close
 * Fecha uma sessão humana (fim de atendimento)
 */
router.post("/:conversationId/close", requireAuth, async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const me = getUserFromReq(req);

    const session = await closeHumanSession(conversationId, {
      closedById: me.id,
      closedByName: me.name,
      closedByRole: me.role
    });

    if (!session) {
      return res.status(404).json({ error: "Sessão não encontrada." });
    }

    res.json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
