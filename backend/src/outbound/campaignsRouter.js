// backend/src/outbound/campaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/campaigns

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

function buildWhere({ modelName, tenantId, channel }) {
  const where = {};
  if (tenantId && modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
  if (channel && modelHasField(modelName, "channel")) where.channel = channel;
  return where;
}

router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await model.findMany({
      where: buildWhere({ modelName, tenantId, channel: "whatsapp" }),
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const where = { id, ...buildWhere({ modelName, tenantId, channel: "whatsapp" }) };

    const item = await model.findFirst({ where });
    if (!item) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET /:id failed");
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

    const { name, templateId, numberId, scheduleAt, metadata } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const data = {};
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) data.channel = "whatsapp";
    if (modelHasField(modelName, "name")) data.name = String(name).trim();
    if (modelHasField(modelName, "status")) data.status = "draft";

    if (modelHasField(modelName, "templateId")) data.templateId = templateId ? String(templateId) : null;
    if (modelHasField(modelName, "numberId")) data.numberId = numberId ? String(numberId) : null;

    if (modelHasField(modelName, "scheduleAt")) {
      data.scheduleAt = scheduleAt ? new Date(scheduleAt) : null;
    }

    if (modelHasField(modelName, "metadata")) data.metadata = metadata ?? undefined;

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");

    const existing = await model.findFirst({
      where: { id, ...buildWhere({ modelName, tenantId, channel: "whatsapp" }) },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.name !== undefined && modelHasField(modelName, "name")) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined && modelHasField(modelName, "status")) data.status = String(req.body.status);
    if (req.body?.templateId !== undefined && modelHasField(modelName, "templateId"))
      data.templateId = req.body.templateId ? String(req.body.templateId) : null;
    if (req.body?.numberId !== undefined && modelHasField(modelName, "numberId"))
      data.numberId = req.body.numberId ? String(req.body.numberId) : null;
    if (req.body?.scheduleAt !== undefined && modelHasField(modelName, "scheduleAt"))
      data.scheduleAt = req.body.scheduleAt ? new Date(req.body.scheduleAt) : null;
    if (req.body?.metadata !== undefined && modelHasField(modelName, "metadata")) data.metadata = req.body.metadata;
    if (req.body?.audience !== undefined && modelHasField(modelName, "audience")) data.audience = req.body.audience;
    if (req.body?.stats !== undefined && modelHasField(modelName, "stats")) data.stats = req.body.stats;

    const item = await model.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
