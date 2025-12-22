// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

/* =========================
 * Helpers
 * ========================= */

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  // precisamos do model que vamos usar
  if (!prisma.outboundCampaign) {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  return true;
}

/* =========================
 * Routes
 * ========================= */

// LISTAR
router.get("/", requireAuth, async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await prisma.outboundCampaign.findMany({
      where: { tenantId, channel: "sms" },
      orderBy: { createdAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// CRIAR
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });

    const item = await prisma.outboundCampaign.create({
      data: {
        tenantId,
        channel: "sms",
        name,
        status: "draft",
        // ✅ MVP: persistimos message em metadata (sem quebrar schema)
        metadata: { ...metadata, message }
      }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
