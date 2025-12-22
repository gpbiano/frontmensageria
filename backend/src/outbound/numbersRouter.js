// backend/src/outbound/numbersRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/numbers

import express from "express";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function normalizeE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  // se já veio com 55 etc, mantemos só dígitos; armazenamos com "+"
  return digits.startsWith("55") ? `+${digits}` : `+${digits}`;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const items = await prisma.outboundNumber.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { phoneE164, label, provider, isActive, metadata } = req.body || {};
    const normalized = normalizeE164(phoneE164);

    if (!normalized || normalized.length < 8) {
      return res.status(400).json({ ok: false, error: "phoneE164_invalid" });
    }

    const item = await prisma.outboundNumber.create({
      data: {
        tenantId,
        phoneE164: normalized,
        label: label ? String(label) : null,
        provider: provider ? String(provider) : "meta",
        isActive: isActive !== undefined ? !!isActive : true,
        metadata: metadata ?? undefined
      }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("Unique constraint") || msg.includes("Unique") || msg.includes("P2002")) {
      return res.status(409).json({ ok: false, error: "number_already_exists" });
    }

    logger.error({ err: err?.message || err }, "❌ numbersRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "id_required" });

    const existing = await prisma.outboundNumber.findFirst({
      where: { id, tenantId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.label !== undefined) data.label = req.body.label ? String(req.body.label) : null;
    if (req.body?.provider !== undefined) data.provider = req.body.provider ? String(req.body.provider) : null;
    if (req.body?.isActive !== undefined) data.isActive = !!req.body.isActive;
    if (req.body?.metadata !== undefined) data.metadata = req.body.metadata;

    const item = await prisma.outboundNumber.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.delete("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    if (!id) return res.status(400).json({ ok: false, error: "id_required" });

    const existing = await prisma.outboundNumber.findFirst({
      where: { id, tenantId },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    await prisma.outboundNumber.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter DELETE /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
