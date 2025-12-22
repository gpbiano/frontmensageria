import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

function now() {
  return new Date();
}

function normalizeWaId(v) {
  const digits = String(v || "").replace(/\D/g, "");
  return digits || null;
}

function safeJson(v, fallback = {}) {
  if (!v || typeof v !== "object") return fallback;
  return v;
}

function mergeMeta(base, patch) {
  const a = safeJson(base, {});
  const b = safeJson(patch, {});
  return { ...a, ...b };
}

/**
 * Envio WhatsApp (texto) - opcional
 * Só roda quando canal === "whatsapp" e houver waId (contact.externalId).
 */
function getWhatsAppConfig() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v21.0").trim();

  if (!token || !phoneNumberId) return null;
  return { token, phoneNumberId, apiVersion };
}

async function sendWhatsAppText({ to, text, timeoutMs = 12000 }) {
  const cfg = getWhatsAppConfig();
  if (!cfg) throw new Error("whatsapp_not_configured");

  const { token, phoneNumberId, apiVersion } = cfg;
  if (!to) throw new Error("whatsapp_invalid_to");
  if (!text) return { skipped: true };

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { preview_url: false, body: text },
  };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    const raw = await r.text().catch(() => "");
    if (!r.ok) throw new Error(`wa_send_failed_${r.status}:${raw || "no_details"}`);

    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  } finally {
    clearTimeout(t);
  }
}

/**
 * Padroniza conversation pro front (parecido com o legado)
 */
function shapeConversation(row) {
  const c = row;
  const contact = c.contact || null;
  const meta = safeJson(c.metadata, {});
  const tags = Array.isArray(meta.tags) ? meta.tags : [];

  return {
    id: c.id,
    tenantId: c.tenantId,
    status: c.status,
    channel: c.channel,
    source: c.channel, // compat legado
    subject: c.subject || null,
    title: contact?.name || contact?.phone || contact?.externalId || "Contato",
    contact: contact
      ? {
          id: contact.id,
          name: contact.name || null,
          phone: contact.phone || null,
          email: contact.email || null,
          externalId: contact.externalId || null,
          channel: contact.channel,
          avatarUrl: contact.avatarUrl || null,
          metadata: safeJson(contact.metadata, {}),
        }
      : null,
    notes: typeof meta.notes === "string" ? meta.notes : "",
    tags,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,

    // preview vem do include (lastMessage) ou do metadata
    lastMessagePreview: c._lastMessagePreview || "",
  };
}

function shapeMessage(m) {
  const meta = safeJson(m.metadata, {});
  return {
    id: m.id,
    tenantId: m.tenantId,
    conversationId: m.conversationId,
    direction: m.direction, // inbound|outbound|internal
    type: m.type,
    text: m.text || "",
    mediaUrl: m.mediaUrl || null,
    fromName: m.fromName || null,
    fromId: m.fromId || null,
    status: m.status, // received|sent|delivered|read|failed
    metadata: meta,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/**
 * GET /conversations
 * query:
 * - status=open|closed|all (default open)
 * - channel=whatsapp|webchat|all
 * - q=texto (busca em contact + subject)
 * - page=1.. (default 1)
 * - pageSize=10..100 (default 20)
 */
router.get("/", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  const prisma = req.prisma; // se você injeta no req, ótimo
  // fallback: import dinâmico (evita circular)
  const prismaClient = prisma || (await import("../lib/prisma.js")).default;

  const status = String(req.query?.status || "open").toLowerCase();
  const channel = String(req.query?.channel || req.query?.source || "all").toLowerCase();
  const q = String(req.query?.q || "").trim();
  const page = Math.max(1, Number(req.query?.page || 1) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(req.query?.pageSize || 20) || 20));
  const skip = (page - 1) * pageSize;

  const where = { tenantId };

  if (status !== "all") where.status = status === "closed" ? "closed" : "open";
  if (channel !== "all") where.channel = channel;

  if (q) {
    where.OR = [
      { subject: { contains: q, mode: "insensitive" } },
      {
        contact: {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { phone: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { externalId: { contains: q, mode: "insensitive" } },
          ],
        },
      },
    ];
  }

  try {
    const [total, rows] = await Promise.all([
      prismaClient.conversation.count({ where }),
      prismaClient.conversation.findMany({
        where,
        include: {
          contact: true,
          messages: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: { text: true, type: true },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        skip,
        take: pageSize,
      }),
    ]);

    // injeta preview
    const shaped = rows.map((c) => {
      const last = (c.messages || [])[0];
      const preview =
        last?.type && last.type !== "text"
          ? `[${last.type}]`
          : String(last?.text || "").slice(0, 120);
      c._lastMessagePreview = preview;
      return shapeConversation(c);
    });

    return res.json({
      data: shaped,
      total,
      page,
      pageSize,
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ conversations list error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /conversations/:id/messages
 */
router.get("/:id/messages", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  const prisma = req.prisma;
  const prismaClient = prisma || (await import("../lib/prisma.js")).default;

  const conversationId = String(req.params.id || "").trim();
  if (!conversationId) return res.status(400).json({ error: "invalid_id" });

  try {
    const conv = await prismaClient.conversation.findFirst({
      where: { id: conversationId, tenantId },
      select: { id: true },
    });

    if (!conv) return res.status(404).json({ error: "not_found" });

    const msgs = await prismaClient.message.findMany({
      where: { tenantId, conversationId },
      orderBy: { createdAt: "asc" },
    });

    return res.json(msgs.map(shapeMessage));
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ messages list error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /conversations/:id/messages
 * body: { text, type?="text", senderName? }
 * -> cria Message outbound
 * -> se conversation.channel === "whatsapp" tenta enviar via Meta (text)
 */
router.post("/:id/messages", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  const prisma = req.prisma;
  const prismaClient = prisma || (await import("../lib/prisma.js")).default;

  const conversationId = String(req.params.id || "").trim();
  if (!conversationId) return res.status(400).json({ error: "invalid_id" });

  const type = String(req.body?.type || "text").toLowerCase();
  const text = String(req.body?.text || "").trim();
  const senderName = String(req.body?.senderName || "Humano").trim();

  if (type !== "text") {
    return res.status(400).json({
      error: "type_not_supported_yet",
      message: "Por enquanto, Prisma-first suporta envio/salvamento de text. (mídia entra no próximo passo)",
    });
  }

  if (!text) return res.status(400).json({ error: "text_required" });

  try {
    const conv = await prismaClient.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: true },
    });

    if (!conv) return res.status(404).json({ error: "not_found" });
    if (String(conv.status) === "closed") return res.status(410).json({ error: "conversation_closed" });

    // cria msg como "sent" (otimista) e ajusta se falhar
    const created = await prismaClient.message.create({
      data: {
        tenantId,
        conversationId,
        direction: "outbound",
        type: "text",
        text,
        fromName: senderName,
        fromId: req.user?.id || null,
        status: "sent",
        metadata: {},
      },
    });

    // atualiza conversation timestamps
    await prismaClient.conversation.update({
      where: { id: conv.id },
      data: {
        lastMessageAt: now(),
        updatedAt: now(),
      },
    });

    // tenta enviar para WhatsApp se canal for whatsapp
    if (String(conv.channel).toLowerCase() === "whatsapp") {
      const waTo = normalizeWaId(conv.contact?.externalId || conv.contact?.phone);
      if (waTo) {
        try {
          const waRes = await sendWhatsAppText({ to: waTo, text });
          const waMessageId = waRes?.messages?.[0]?.id || null;

          const patched = await prismaClient.message.update({
            where: { id: created.id },
            data: {
              status: "sent",
              metadata: {
                delivery: { channel: "whatsapp", status: "sent", at: new Date().toISOString() },
                waMessageId,
                wa: waRes,
              },
            },
          });

          return res.status(201).json(shapeMessage(patched));
        } catch (err) {
          const patched = await prismaClient.message.update({
            where: { id: created.id },
            data: {
              status: "failed",
              metadata: {
                delivery: {
                  channel: "whatsapp",
                  status: "failed",
                  at: new Date().toISOString(),
                  error: String(err?.message || err),
                },
              },
            },
          });

          // responde 201 mesmo falhando envio (mensagem salva)
          return res.status(201).json(shapeMessage(patched));
        }
      }
    }

    return res.status(201).json(shapeMessage(created));
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ message create error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /conversations/:id/status
 * body: { status: "open"|"closed", tags?: [] }
 */
router.patch("/:id/status", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  const prisma = req.prisma;
  const prismaClient = prisma || (await import("../lib/prisma.js")).default;

  const conversationId = String(req.params.id || "").trim();
  const status = String(req.body?.status || "").toLowerCase();

  if (!["open", "closed"].includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }

  try {
    const conv = await prismaClient.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: true },
    });

    if (!conv) return res.status(404).json({ error: "not_found" });

    const nextMeta = mergeMeta(conv.metadata, {});
    if (Array.isArray(req.body?.tags)) nextMeta.tags = req.body.tags;

    const updated = await prismaClient.conversation.update({
      where: { id: conv.id },
      data: {
        status,
        metadata: nextMeta,
        updatedAt: now(),
      },
      include: { contact: true },
    });

    // inclui preview básico
    updated._lastMessagePreview = "";

    return res.json(shapeConversation(updated));
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ conversation status error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /conversations/:id/notes
 * body: { notes: "..." }
 */
router.patch("/:id/notes", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  const prisma = req.prisma;
  const prismaClient = prisma || (await import("../lib/prisma.js")).default;

  const conversationId = String(req.params.id || "").trim();
  const notes = String(req.body?.notes || "");

  try {
    const conv = await prismaClient.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: true },
    });

    if (!conv) return res.status(404).json({ error: "not_found" });

    const nextMeta = mergeMeta(conv.metadata, { notes });

    const updated = await prismaClient.conversation.update({
      where: { id: conv.id },
      data: { metadata: nextMeta, updatedAt: now() },
      include: { contact: true },
    });

    updated._lastMessagePreview = "";
    return res.json(shapeConversation(updated));
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ conversation notes error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;

