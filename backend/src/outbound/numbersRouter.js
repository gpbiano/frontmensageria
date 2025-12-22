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

function assertPrisma(res) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  return true;
}

/**
 * Normaliza telefone:
 * - aceita "+5511999999999" ou "5511999999999" ou "11 99999-9999"
 * - garante prefixo "+"
 * - regra mínima: 8+ dígitos totais (depois de limpar)
 */
function normalizeE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 8) return "";
  return digits.startsWith("+") ? digits : `+${digits}`;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

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
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { phoneE164, label, provider, isActive, metadata } = req.body || {};
    const normalized = normalizeE164(phoneE164);

    if (!normalized) {
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

    // Prisma unique constraint
    if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ ok: false, error: "number_already_exists" });
    }

    logger.error({ err: err?.message || err }, "❌ numbersRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
