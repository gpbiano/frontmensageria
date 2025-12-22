// backend/src/outbound/campaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res) {
  if (!prisma?.outboundCampaign) {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  return true;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const items = await prisma.outboundCampaign.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { createdAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const item = await prisma.outboundCampaign.findFirst({
      where: { id, tenantId, channel: "whatsapp" }
    });

    if (!item) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { name, templateId, numberId, scheduleAt, metadata } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const item = await prisma.outboundCampaign.create({
      data: {
        tenantId,
        channel: "whatsapp",
        name: String(name).trim(),
        status: "draft",
        templateId: templateId ? String(templateId) : null,
        numberId: numberId ? String(numberId) : null,
        scheduleAt: scheduleAt ? new Date(scheduleAt) : null,
        metadata: metadata ?? undefined
      }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    if (!assertPrisma(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await prisma.outboundCampaign.findFirst({
      where: { id, tenantId, channel: "whatsapp" },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined) data.status = String(req.body.status);
    if (req.body?.templateId !== undefined)
      data.templateId = req.body.templateId ? String(req.body.templateId) : null;
    if (req.body?.numberId !== undefined)
      data.numberId = req.body.numberId ? String(req.body.numberId) : null;
    if (req.body?.scheduleAt !== undefined)
      data.scheduleAt = req.body.scheduleAt ? new Date(req.body.scheduleAt) : null;
    if (req.body?.metadata !== undefined) data.metadata = req.body.metadata;
    if (req.body?.audience !== undefined) data.audience = req.body.audience;
    if (req.body?.stats !== undefined) data.stats = req.body.stats;

    const item = await prisma.outboundCampaign.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
