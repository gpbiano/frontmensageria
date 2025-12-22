// backend/src/outbound/optoutRouter.js
// ✅ PRISMA-FIRST (SEM optout.json/data.json)
// Base: /outbound/optout

import express from "express";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  return true;
}

function normalizeTarget(raw) {
  // pode ser phone ou external id — aqui normalizamos “phone-like”
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10) return digits; // phone BR sem "+"
  return s.toLowerCase();
}

/**
 * GET /outbound/optout?page=1&limit=25&channel=whatsapp&query=...
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));
    const skip = (page - 1) * limit;

    const channel = String(req.query.channel || "whatsapp").trim() || "whatsapp";
    const q = String(req.query.query || "").trim();

    const where = {
      tenantId,
      channel,
      ...(q
        ? {
            OR: [
              { target: { contains: q, mode: "insensitive" } },
              { reason: { contains: q, mode: "insensitive" } }
            ]
          }
        : {})
    };

    const [total, items] = await Promise.all([
      prisma.optOutEntry.count({ where }),
      prisma.optOutEntry.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: limit
      })
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * POST /outbound/optout
 * Body: { channel?, target, reason? }
 */
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const channel = String(req.body?.channel || "whatsapp").trim() || "whatsapp";
    const target = normalizeTarget(req.body?.target);
    const reason = req.body?.reason ? String(req.body.reason) : null;

    if (!target) return res.status(400).json({ ok: false, error: "target_required" });

    const item = await prisma.optOutEntry.upsert({
      where: { tenantId_channel_target: { tenantId, channel, target } },
      create: { tenantId, channel, target, reason, isActive: true },
      update: { reason, isActive: true }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * DELETE /outbound/optout/:id
 */
router.delete("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ ok: false, error: "invalid_id" });

    const existing = await prisma.optOutEntry.findFirst({
      where: { id, tenantId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    await prisma.optOutEntry.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter DELETE /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;

