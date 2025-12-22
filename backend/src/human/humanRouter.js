// backend/src/human/humanRouter.js
import express from "express";
import {
  listHumanSessions,
  listHumanActions,
  logHumanAction,
  closeHumanSession
} from "./humanHistory.js";

import { loadDB, saveDB } from "../utils/db.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { appendMessage } from "../routes/conversations.js";

const router = express.Router();

/**
 * Helper padrão para identificar o usuário logado
 */
function getUserFromReq(req) {
  const u = req.user || {};
  return {
    id: u.id || u.userId || "unknown",
    name: u.name || u.fullName || u.email || "Atendente",
    role: u.role || "agent"
  };
}

// ======================================================
// PING
// ======================================================
router.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Módulo de atendimento humano ativo."
  });
});

// ======================================================
// LISTAGEM
// ======================================================
router.get("/sessions", requireAuth, async (req, res, next) => {
  try {
    const sessions = await listHumanSessions();
    res.json(sessions);
  } catch (err) {
    next(err);
  }
});

router.get("/actions", requireAuth, async (req, res, next) => {
  try {
    const actions = await listHumanActions();
    res.json(actions);
  } catch (err) {
    next(err);
  }
});

// ======================================================
// TAKEOVER / AÇÕES HUMANAS
// ======================================================
router.post("/actions", requireAuth, async (req, res, next) => {
  try {
    const { conversationId, type, note } = req.body || {};

    if (!conversationId || !type) {
      return res.status(400).json({
        error: "conversationId e type são obrigatórios."
      });
    }

    const me = getUserFromReq(req);

    // ==================================================
    // 🔥 TAKEOVER (humano assume a conversa)
    // ==================================================
    if (type === "takeover") {
      const db = loadDB();

      // mensagem de sistema (não vai pro WhatsApp)
      appendMessage(db, conversationId, {
        type: "system",
        from: "agent",
        direction: "out",
        isSystem: true,
        text: `Atendimento assumido por ${me.name}`,
        handoff: true // 🔑 promove definitivamente para inbox
      });

      saveDB(db);
    }

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

// ======================================================
// ENCERRAR ATENDIMENTO HUMANO
// ======================================================
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

    // 🔒 fecha conversa no core
    const db = loadDB();
    appendMessage(db, conversationId, {
      type: "system",
      from: "agent",
      direction: "out",
      isSystem: true,
      text: `Atendimento encerrado por ${me.name}`
    });

    // marca como closed
    const conv = db.conversations?.find(c => String(c.id) === String(conversationId));
    if (conv) {
      conv.status = "closed";
      conv.closedAt = new Date().toISOString();
    }

    saveDB(db);

    res.json(session);
  } catch (err) {
    next(err);
  }
});

export default router;
