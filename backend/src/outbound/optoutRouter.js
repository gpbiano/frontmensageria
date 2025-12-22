// backend/src/outbound/optoutRouter.js
import express from "express";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

// ===============================
// HELPERS
// ===============================
function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId || req.user?.tenantId;
  return tenantId ? String(tenantId) : null;
}

function normalizePhone(v) {
  // mantém só dígitos (compat com legado)
  return String(v || "").replace(/\D/g, "");
}

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.min(max, Math.max(min, x));
}

// ===============================
// GET /outbound/optout?page=1&limit=25
// ===============================
router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const page = clamp(req.query.page || 1, 1, 1_000_000);
    const limit = clamp(req.query.limit || 25, 1, 200);
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      prisma.optOutEntry.count({
        where: { tenantId, isActive: true }
      }),
      prisma.optOutEntry.findMany({
        where: { tenantId, isActive: true },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      })
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      phone: r.target, // compat: no legado era "phone"
      name: "", // legado tinha name; agora opcional via metadata se quiser
      reason: r.reason || "",
      source: "db",
      channel: r.channel,
      createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null
    }));

    return res.json({ data, total, page, limit });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no GET /outbound/optout");
    return res.status(200).json({ data: [], total: 0, page: 1, limit: 25 });
  }
});

// ===============================
// GET /outbound/optout/whatsapp-contacts
// Retorna contatos do Prisma que NÃO estão em opt-out (whatsapp)
// ===============================
router.get("/whatsapp-contacts", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    // pega optout targets (whatsapp)
    const optouts = await prisma.optOutEntry.findMany({
      where: { tenantId, channel: "whatsapp", isActive: true },
      select: { target: true }
    });

    const blocked = new Set(optouts.map((o) => normalizePhone(o.target)));

    // contatos whatsapp no banco
    // OBS: seu Contact tem (channel, phone). Vamos filtrar por channel='whatsapp' e phone not null
    const contacts = await prisma.contact.findMany({
      where: {
        tenantId,
        channel: "whatsapp"
      },
      select: {
        id: true,
        name: true,
        phone: true,
        externalId: true,
        avatarUrl: true,
        metadata: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" },
      take: 5000 // proteção; depois a gente pagina se precisar
    });

    const available = contacts.filter((c) => {
      const p = normalizePhone(c?.phone);
      if (!p) return false;
      return !blocked.has(p);
    });

    return res.json({ data: available, total: available.length });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no GET /outbound/optout/whatsapp-contacts");
    return res.status(200).json({ data: [], total: 0 });
  }
});

// ===============================
// POST /outbound/optout
// body: { phone, name?, reason?, source?, channel? }
// ===============================
router.post("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { phone, reason, channel } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone_required" });

    const p = normalizePhone(phone);
    if (!p) return res.status(400).json({ error: "invalid_phone" });

    const ch = String(channel || "whatsapp").toLowerCase();

    // upsert by unique (tenantId, channel, target)
    const row = await prisma.optOutEntry.upsert({
      where: {
        tenantId_channel_target: {
          tenantId,
          channel: ch,
          target: p
        }
      },
      update: {
        isActive: true,
        reason: reason ? String(reason) : null
      },
      create: {
        tenantId,
        channel: ch,
        target: p,
        reason: reason ? String(reason) : null,
        isActive: true
      }
    });

    // se já existia ativo, consideramos duplicado (compat)
    // não tem como saber perfeito no upsert sem outra query, mas dá pra inferir:
    // se updatedAt != createdAt provavelmente já existia, mas não é confiável.
    // vamos fazer simples e idempotente:
    return res.status(201).json({ success: true, id: row.id });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no POST /outbound/optout");
    return res.status(500).json({ error: "internal_error" });
  }
});

// ===============================
// DELETE /outbound/optout/:id
// (soft delete: isActive=false) — mais seguro para auditoria
// ===============================
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { id } = req.params;

    const row = await prisma.optOutEntry.findFirst({
      where: { id: String(id), tenantId }
    });

    if (!row) return res.status(404).json({ error: "not_found" });

    await prisma.optOutEntry.update({
      where: { id: row.id },
      data: { isActive: false }
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no DELETE /outbound/optout/:id");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
