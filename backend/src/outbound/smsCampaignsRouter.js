// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
}
function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return true;
  }
}
function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}
function assertPrisma(res, model, candidates) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({ ok: false, error: "prisma_model_missing", details: { expectedAnyOf: candidates } });
    return false;
  }
  return true;
}

const MODEL_CANDIDATES = ["outboundCampaign", "OutboundCampaign", "campaign", "Campaign"];

router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) where.channel = "sms";

    const items = await model.findMany({
      where,
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });

    const data = {};
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) data.channel = "sms";
    if (modelHasField(modelName, "name")) data.name = name;
    if (modelHasField(modelName, "status")) data.status = "draft";
    if (modelHasField(modelName, "metadata")) data.metadata = { ...metadata, message };

    const item = await model.create({ data });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
