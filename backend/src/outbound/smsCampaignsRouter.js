// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns

import express from "express";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

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

router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { name, message, metadata } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const item = await prisma.outboundCampaign.create({
      data: {
        tenantId,
        channel: "sms",
        name: String(name).trim(),
        status: "draft",
        metadata: { ...(metadata || {}), message: String(message) }
      }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const item = await prisma.outboundCampaign.findFirst({
      where: { id, tenantId, channel: "sms" }
    });

    if (!item) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await prisma.outboundCampaign.findFirst({
      where: { id, tenantId, channel: "sms" },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.name !== undefined) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined) data.status = String(req.body.status);
    if (req.body?.metadata !== undefined) data.metadata = req.body.metadata;
    if (req.body?.audience !== undefined) data.audience = req.body.audience;
    if (req.body?.stats !== undefined) data.stats = req.body.stats;
    if (req.body?.scheduleAt !== undefined) data.scheduleAt = req.body.scheduleAt ? new Date(req.body.scheduleAt) : null;

    const item = await prisma.outboundCampaign.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
