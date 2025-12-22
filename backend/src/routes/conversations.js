// backend/src/routes/conversations.js
import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import logger from "../logger.js";

const router = express.Router();

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId;
  return tenantId ? String(tenantId) : null;
}

function parseIntSafe(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function shapeConversation(c) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    channel: c.channel,
    status: c.status,
    subject: c.subject,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    contact: c.contact
      ? {
          id: c.contact.id,
          name: c.contact.name,
          phone: c.contact.phone,
          email: c.contact.email,
          channel: c.contact.channel,
          externalId: c.contact.externalId,
          avatarUrl: c.contact.avatarUrl,
        }
      : undefined,
    lastMessage: c.messages?.[0]
      ? {
          id: c.messages[0].id,
          direction: c.messages[0].direction,
          type: c.messages[0].type,
          text: c.messages[0].text,
          createdAt: c.messages[0].createdAt,
          status: c.messages[0].status,
        }
      : undefined,
  };
}

function shapeMessage(m) {
  return {
    id: m.id,
    tenantId: m.tenantId,
    conversationId: m.conversationId,
    direction: m.direction,
    type: m.type,
    text: m.text,
    mediaUrl: m.mediaUrl,
    fromName: m.fromName,
    fromId: m.fromId,
    status: m.status,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    metadata: m.metadata ?? null,
  };
}

/**
 * GET /conversations
 * (admin/manager/agent/viewer) - lista conversas do tenant (paginado)
 * query: q, status, channel, page, pageSize
 */
router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const page = Math.max(1, parseIntSafe(req.query?.page, 1));
      const pageSize = Math.min(50, Math.max(10, parseIntSafe(req.query?.pageSize, 20)));
      const skip = (page - 1) * pageSize;

      const q = String(req.query?.q || "").trim();
      const status = String(req.query?.status || "").trim(); // open|closed
      const channel = String(req.query?.channel || "").trim();

      const where = {
        tenantId,
        ...(status ? { status } : {}),
        ...(channel ? { channel } : {}),
        ...(q
          ? {
              OR: [
                { subject: { contains: q, mode: "insensitive" } },
                { contact: { name: { contains: q, mode: "insensitive" } } },
                { contact: { phone: { contains: q, mode: "insensitive" } } },
                { contact: { email: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      };

      const [total, rows] = await Promise.all([
        prisma.conversation.count({ where }),
        prisma.conversation.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
          include: {
            contact: true,
            messages: {
              take: 1,
              orderBy: { createdAt: "desc" },
              select: { id: true, direction: true, type: true, text: true, createdAt: true, status: true },
            },
          },
        }),
      ]);

      return res.json({
        data: rows.map(shapeConversation),
        page,
        pageSize,
        total,
      });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ conversations list error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * GET /conversations/:id
 * (admin/manager/agent/viewer) - detalhe
 */
router.get(
  "/:id",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const conv = await prisma.conversation.findFirst({
        where: { id, tenantId },
        include: { contact: true },
      });

      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      return res.json({ conversation: shapeConversation({ ...conv, messages: [] }) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ conversation get error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * GET /conversations/:id/messages
 * (admin/manager/agent/viewer) - mensagens paginadas
 * query: before (ISO), pageSize
 */
router.get(
  "/:id/messages",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent", "viewer"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const conversationId = String(req.params.id || "").trim();
      if (!conversationId) return res.status(400).json({ error: "ID inválido." });

      const pageSize = Math.min(100, Math.max(20, parseIntSafe(req.query?.pageSize, 50)));
      const before = String(req.query?.before || "").trim();

      const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const where = {
        tenantId,
        conversationId,
        ...(before ? { createdAt: { lt: new Date(before) } } : {}),
      };

      const msgs = await prisma.message.findMany({
        where,
        take: pageSize,
        orderBy: { createdAt: "desc" },
      });

      // front geralmente exibe crescente
      const items = msgs.reverse().map(shapeMessage);
      const nextCursor = msgs.length ? msgs[msgs.length - 1].createdAt.toISOString() : null;

      return res.json({ data: items, nextCursor });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ messages list error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /conversations/:id/messages
 * (admin/manager/agent) - registra mensagem no histórico
 * body: { direction, type?, text?, mediaUrl?, status?, fromName?, fromId?, metadata? }
 */
router.post(
  "/:id/messages",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const conversationId = String(req.params.id || "").trim();
      if (!conversationId) return res.status(400).json({ error: "ID inválido." });

      const conv = await prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const direction = String(req.body?.direction || "outbound").trim().toLowerCase(); // inbound|outbound|internal
      const type = String(req.body?.type || "text").trim().toLowerCase();
      const text = req.body?.text != null ? String(req.body.text) : null;
      const mediaUrl = req.body?.mediaUrl != null ? String(req.body.mediaUrl) : null;
      const status = String(req.body?.status || "sent").trim().toLowerCase();
      const fromName = req.body?.fromName != null ? String(req.body.fromName) : null;
      const fromId = req.body?.fromId != null ? String(req.body.fromId) : null;
      const metadata = req.body?.metadata ?? null;

      if (!["inbound", "outbound", "internal"].includes(direction)) {
        return res.status(400).json({ error: "direction inválido (inbound|outbound|internal)." });
      }

      if (type === "text" && (!text || !text.trim())) {
        return res.status(400).json({ error: "text é obrigatório para mensagens text." });
      }

      const created = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
          data: {
            tenantId,
            conversationId,
            direction,
            type,
            text: text ? text.trim() : null,
            mediaUrl,
            status,
            fromName,
            fromId,
            metadata,
          },
        });

        await tx.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: msg.createdAt },
        });

        return msg;
      });

      return res.status(201).json({ success: true, message: shapeMessage(created) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ message create error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /conversations/:id
 * (admin/manager/agent) - atualiza status/subject/metadata
 * body: { status?, subject?, metadata? }
 */
router.patch(
  "/:id",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager", "agent"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "ID inválido." });

      const conv = await prisma.conversation.findFirst({ where: { id, tenantId } });
      if (!conv) return res.status(404).json({ error: "Conversa não encontrada." });

      const data = {};

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
        const status = String(req.body?.status || "").trim().toLowerCase();
        if (!["open", "closed"].includes(status)) {
          return res.status(400).json({ error: "status inválido (open|closed)." });
        }
        data.status = status;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "subject")) {
        const subject = String(req.body?.subject || "").trim();
        data.subject = subject || null;
      }

      if (Object.prototype.hasOwnProperty.call(req.body || {}, "metadata")) {
        data.metadata = req.body?.metadata ?? null;
      }

      const updated = await prisma.conversation.update({
        where: { id: conv.id },
        data,
        include: { contact: true },
      });

      return res.json({ success: true, conversation: shapeConversation({ ...updated, messages: [] }) });
    } catch (e) {
      logger.error({ err: e?.message || e }, "❌ conversation patch error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;

