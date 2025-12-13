import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "evt") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

/**
 * Cria “mensagem de sistema” dentro da conversa.
 * Se você já tem um formato de message, adapte aqui.
 */
function pushSystemEvent(db, conversationId, payload) {
  db.messagesByConversation = db.messagesByConversation || {};
  db.messagesByConversation[conversationId] = ensureArray(db.messagesByConversation[conversationId]);

  const msg = {
    id: newId("sys"),
    type: "system",
    timestamp: nowIso(),
    ...payload
  };

  db.messagesByConversation[conversationId].push(msg);
}

function getUserFromReq(req) {
  // Ajuste conforme teu JWT (normalmente req.user vem do requireAuth)
  // Espero algo tipo: { id, name, role }
  return req.user || { id: "unknown", name: "Usuário", role: "viewer" };
}

function findConversation(db, id) {
  db.conversations = ensureArray(db.conversations);
  return db.conversations.find((c) => c.id === id);
}

/**
 * ✅ Assumir atendimento
 * PATCH /human/conversations/:id/assign
 * body: { agentId?, groupId? }
 *
 * Se agentId não vier, assume o próprio usuário logado.
 */
router.patch(
  "/conversations/:id/assign",
  requireAuth,
  requireRole("admin", "manager", "agent"),
  (req, res) => {
    const db = loadDB();
    const conv = findConversation(db, req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

    const me = getUserFromReq(req);
    const agentId = String(req.body?.agentId || me.id);
    const groupId = req.body?.groupId ? String(req.body.groupId) : conv.groupId;

    conv.groupId = groupId || conv.groupId || null;
    conv.assignedAgentId = agentId;
    conv.assignedAt = nowIso();
    conv.lastTransferAt = conv.lastTransferAt || null;

    // Evento para auditoria + UI
    pushSystemEvent(db, conv.id, {
      event: "assigned",
      textPublic: "Seu atendimento foi iniciado por um especialista.",
      textInternal: `Atendimento iniciado por ${me.name}`,
      by: me.id,
      byName: me.name,
      to: agentId,
      groupId: conv.groupId
    });

    saveDB(db);
    res.json({ ok: true, conversation: conv });
  }
);

/**
 * ✅ Transferir para outro agente (mesmo grupo)
 * PATCH /human/conversations/:id/transfer-agent
 * body: { toAgentId }
 */
router.patch(
  "/conversations/:id/transfer-agent",
  requireAuth,
  requireRole("admin", "manager", "agent"),
  (req, res) => {
    const db = loadDB();
    const conv = findConversation(db, req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

    const me = getUserFromReq(req);
    const toAgentId = String(req.body?.toAgentId || "");
    if (!toAgentId) return res.status(400).json({ error: "toAgentId é obrigatório." });

    const fromAgentId = conv.assignedAgentId || null;

    conv.assignedAgentId = toAgentId;
    conv.lastTransferAt = nowIso();

    pushSystemEvent(db, conv.id, {
      event: "transfer_agent",
      textPublic: "Seu atendimento foi transferido para outro especialista.",
      textInternal: `Transferência de agente: ${fromAgentId || "-"} -> ${toAgentId}`,
      by: me.id,
      byName: me.name,
      from: fromAgentId,
      to: toAgentId,
      groupId: conv.groupId || null
    });

    saveDB(db);
    res.json({ ok: true, conversation: conv });
  }
);

/**
 * ✅ Transferir para outro grupo (entra em fila: assignedAgentId = null)
 * PATCH /human/conversations/:id/transfer-group
 * body: { toGroupId }
 */
router.patch(
  "/conversations/:id/transfer-group",
  requireAuth,
  requireRole("admin", "manager"),
  (req, res) => {
    const db = loadDB();
    const conv = findConversation(db, req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

    const me = getUserFromReq(req);
    const toGroupId = String(req.body?.toGroupId || "");
    if (!toGroupId) return res.status(400).json({ error: "toGroupId é obrigatório." });

    const fromGroupId = conv.groupId || null;
    const fromAgentId = conv.assignedAgentId || null;

    conv.groupId = toGroupId;
    conv.assignedAgentId = null; // fila do novo grupo
    conv.lastTransferAt = nowIso();

    pushSystemEvent(db, conv.id, {
      event: "transfer_group",
      textPublic: "Estamos direcionando você para o setor responsável 😊",
      textInternal: `Transferência de grupo: ${fromGroupId || "-"} -> ${toGroupId} (agent cleared)`,
      by: me.id,
      byName: me.name,
      fromGroupId,
      toGroupId,
      fromAgentId
    });

    saveDB(db);
    res.json({ ok: true, conversation: conv });
  }
);

export default router;
