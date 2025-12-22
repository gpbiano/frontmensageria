// backend/src/human/assignmentRouter.js
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "evt") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function asJson(v) {
  return v && typeof v === "object" ? v : {};
}

function metaGet(row) {
  return asJson(row?.metadata);
}

function metaSet(row, patch) {
  const curr = metaGet(row);
  return { ...curr, ...asJson(patch) };
}

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId || req.user?.tenantId;
  return tenantId ? String(tenantId) : null;
}

function getUserFromReq(req) {
  const u = req.user || {};
  return {
    id: String(u.id || u.userId || "unknown"),
    name: u.name || u.fullName || u.email || "Usuário",
    role: u.role || "viewer"
  };
}

/**
 * Cria “mensagem de sistema” dentro da conversa (PRISMA).
 * Mantém compat com o conceito de auditoria/UI do legado.
 */
async function pushSystemEvent({ tenantId, conversationId, payload }) {
  const msg = await prisma.message.create({
    data: {
      id: newId("sys"),
      tenantId,
      conversationId,
      direction: "out",
      type: "system",
      text: payload?.textPublic || payload?.textInternal || null,
      status: "sent",
      metadata: {
        ...payload,
        // campos compat com legado
        timestamp: nowIso()
      },
      createdAt: new Date()
    }
  });

  return msg;
}

async function findConversationOr404({ tenantId, id }) {
  const conv = await prisma.conversation.findFirst({
    where: { id, tenantId }
  });
  return conv;
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
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const conv = await findConversationOr404({ tenantId, id: req.params.id });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const me = getUserFromReq(req);
      const agentId = String(req.body?.agentId || me.id);
      const groupId = req.body?.groupId ? String(req.body.groupId) : null;

      const meta = metaGet(conv);

      const patch = {
        // compat legado
        groupId: groupId || meta.groupId || null,
        assignedAgentId: agentId,
        assignedAt: nowIso(),
        lastTransferAt: meta.lastTransferAt || null,

        // convergência com o humanRouter novo
        assignedGroupId: groupId || meta.assignedGroupId || meta.groupId || null,
        assignedUserId: agentId,
        claimedAt: nowIso(),
        claimedById: me.id,
        claimedByName: me.name,

        currentMode: "human",
        hadHuman: true,
        handoffActive: true,
        handoffSince: meta.handoffSince || nowIso(),

        inboxVisible: true,
        inboxStatus: "in_progress"
      };

      const updated = await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          metadata: metaSet(conv, patch)
        }
      });

      // Evento para auditoria + UI
      await pushSystemEvent({
        tenantId,
        conversationId: conv.id,
        payload: {
          event: "assigned",
          textPublic: "Seu atendimento foi iniciado por um especialista.",
          textInternal: `Atendimento iniciado por ${me.name}`,
          by: me.id,
          byName: me.name,
          to: agentId,
          groupId: patch.groupId
        }
      });

      // devolve conversation no shape “compatível”
      const out = { ...updated, ...metaSet(updated, {}) };
      res.json({ ok: true, conversation: out });
    } catch (e) {
      res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
    }
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
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const conv = await findConversationOr404({ tenantId, id: req.params.id });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const me = getUserFromReq(req);
      const toAgentId = String(req.body?.toAgentId || "").trim();
      if (!toAgentId) return res.status(400).json({ error: "toAgentId é obrigatório." });

      const meta = metaGet(conv);
      const fromAgentId = meta.assignedAgentId || meta.assignedUserId || null;

      const patch = {
        assignedAgentId: toAgentId,
        assignedUserId: toAgentId,
        lastTransferAt: nowIso(),

        inboxVisible: true,
        inboxStatus: "in_progress",
        currentMode: "human",
        handoffActive: true,
        hadHuman: true
      };

      const updated = await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          metadata: metaSet(conv, patch)
        }
      });

      await pushSystemEvent({
        tenantId,
        conversationId: conv.id,
        payload: {
          event: "transfer_agent",
          textPublic: "Seu atendimento foi transferido para outro especialista.",
          textInternal: `Transferência de agente: ${fromAgentId || "-"} -> ${toAgentId}`,
          by: me.id,
          byName: me.name,
          from: fromAgentId,
          to: toAgentId,
          groupId: meta.groupId || meta.assignedGroupId || null
        }
      });

      const out = { ...updated, ...metaSet(updated, {}) };
      res.json({ ok: true, conversation: out });
    } catch (e) {
      res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
    }
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
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const conv = await findConversationOr404({ tenantId, id: req.params.id });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const me = getUserFromReq(req);
      const toGroupId = String(req.body?.toGroupId || "").trim();
      if (!toGroupId) return res.status(400).json({ error: "toGroupId é obrigatório." });

      const meta = metaGet(conv);
      const fromGroupId = meta.groupId || meta.assignedGroupId || null;
      const fromAgentId = meta.assignedAgentId || meta.assignedUserId || null;

      const patch = {
        groupId: toGroupId,
        assignedGroupId: toGroupId,

        assignedAgentId: null,
        assignedUserId: null,

        lastTransferAt: nowIso(),

        // volta pra fila
        inboxVisible: true,
        inboxStatus: "waiting_human",
        queuedAt: nowIso(),

        currentMode: "human",
        handoffActive: true,
        hadHuman: true,
        handoffSince: meta.handoffSince || nowIso()
      };

      const updated = await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          metadata: metaSet(conv, patch)
        }
      });

      await pushSystemEvent({
        tenantId,
        conversationId: conv.id,
        payload: {
          event: "transfer_group",
          textPublic: "Estamos direcionando você para o setor responsável 😊",
          textInternal: `Transferência de grupo: ${fromGroupId || "-"} -> ${toGroupId} (agent cleared)`,
          by: me.id,
          byName: me.name,
          fromGroupId,
          toGroupId,
          fromAgentId
        }
      });

      const out = { ...updated, ...metaSet(updated, {}) };
      res.json({ ok: true, conversation: out });
    } catch (e) {
      res.status(500).json({ error: "internal_error", detail: String(e?.message || e) });
    }
  }
);

export default router;
