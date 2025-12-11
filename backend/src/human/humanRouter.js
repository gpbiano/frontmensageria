// backend/src/human/humanRouter.js
import express from "express";
import {
  listHumanSessions,
  listHumanActions,
  logHumanAction,
  closeHumanSession
} from "./humanHistory.js";

const router = express.Router();

/**
 * MÓDULO HUMAN
 * -------------
 * Rotas relacionadas ao atendimento humano.
 * Toda a persistência fica em humanStorage.js / humanHistory.js,
 * usando o arquivo human-data.json na raiz do backend.
 */

// Ping simples para saber se o módulo está ativo
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Módulo de atendimento humano ativo."
  });
});

/**
 * GET /api/human/sessions
 * Lista sessões humanas registradas (para dashboards futuros).
 */
router.get("/sessions", async (req, res, next) => {
  try {
    const sessions = await listHumanSessions();
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/human/actions
 * Lista ações dos atendentes (log de atividade humano).
 */
router.get("/actions", async (req, res, next) => {
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
 *   "conversationId": 123,
 *   "agent": "Genivaldo",
 *   "type": "note|takeover|release|tag_change|status_change",
 *   "note": "texto opcional"
 * }
 */
router.post("/actions", async (req, res, next) => {
  try {
    const { conversationId, agent, type, note } = req.body || {};

    if (!conversationId || !type) {
      return res.status(400).json({
        error: "conversationId e type são obrigatórios."
      });
    }

    const action = await logHumanAction({
      conversationId,
      agent: agent || "unknown",
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
 * Fecha uma sessão humana (marcando endAt no histórico).
 */
router.post("/:conversationId/close", async (req, res, next) => {
  try {
    const { conversationId } = req.params;

    const session = await closeHumanSession(conversationId);

    if (!session) {
      return res.status(404).json({ error: "Sessão não encontrada." });
    }

    res.json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
