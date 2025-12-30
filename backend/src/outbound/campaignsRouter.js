// backend/src/outbound/campaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * Resolve delegate + nome do Model no DMMF.
 * Prisma client usa delegate em camelCase (ex: prisma.outboundCampaign)
 * DMMF usa Model em PascalCase (ex: OutboundCampaign)
 */
const MODEL_CANDIDATES = [
  // delegateKey -> modelName provável
  { delegateKey: "outboundCampaign", modelName: "OutboundCampaign" },
  { delegateKey: "campaign", modelName: "Campaign" },

  // fallback (caso alguém tenha gerado Prisma com nomes diferentes)
  { delegateKey: "OutboundCampaign", modelName: "OutboundCampaign" },
  { delegateKey: "Campaign", modelName: "Campaign" }
];

function resolveModel() {
  for (const c of MODEL_CANDIDATES) {
    if (prisma?.[c.delegateKey]) {
      return { model: prisma[c.delegateKey], modelName: c.modelName, delegateKey: c.delegateKey };
    }
  }
  return { model: null, modelName: null, delegateKey: null };
}

function modelHasField(modelName, field) {
  try {
    const models = prisma?._dmmf?.datamodel?.models || [];
    const m = models.find((x) => x.name === modelName);
    // Se não encontrou o model no DMMF, melhor "assumir true" pra não quebrar produção
    if (!m) return true;
    return !!m.fields?.some((f) => f.name === field);
  } catch {
    return true;
  }
}

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res, modelInfo) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!modelInfo?.model) {
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expectedAnyOf: MODEL_CANDIDATES.map((c) => c.delegateKey) }
    });
    return false;
  }
  return true;
}

function buildWhere({ modelName, tenantId, channel }) {
  const where = {};
  if (tenantId && modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
  if (channel && modelHasField(modelName, "channel")) where.channel = channel;
  return where;
}

// ======================================================
// GET /outbound/campaigns
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  const modelInfo = resolveModel();
  try {
    if (!assertPrisma(res, modelInfo)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = buildWhere({ modelName: modelInfo.modelName, tenantId, channel: "whatsapp" });

    const items = await modelInfo.model.findMany({
      where,
      orderBy: modelHasField(modelInfo.modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error(
      { err: err?.message || err, stack: err?.stack, model: modelInfo },
      "❌ campaignsRouter GET / failed"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// GET /outbound/campaigns/:id
// ======================================================
router.get("/:id", requireAuth, async (req, res) => {
  const modelInfo = resolveModel();
  try {
    if (!assertPrisma(res, modelInfo)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const where = { id, ...buildWhere({ modelName: modelInfo.modelName, tenantId, channel: "whatsapp" }) };

    const item = await modelInfo.model.findFirst({ where });
    if (!item) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error(
      { err: err?.message || err, stack: err?.stack, model: modelInfo },
      "❌ campaignsRouter GET /:id failed"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/campaigns
// ======================================================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const modelInfo = resolveModel();
  try {
    if (!assertPrisma(res, modelInfo)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { name, templateId, templateName, numberId, scheduleAt, metadata } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: "name_required" });

    const data = {};

    if (modelHasField(modelInfo.modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelInfo.modelName, "channel")) data.channel = "whatsapp";

    if (modelHasField(modelInfo.modelName, "name")) data.name = String(name).trim();
    if (modelHasField(modelInfo.modelName, "status")) data.status = "draft";

    // Compat: alguns fronts mandam templateName ao invés de templateId
    if (modelHasField(modelInfo.modelName, "templateId")) {
      data.templateId = templateId ? String(templateId) : null;
    }
    if (modelHasField(modelInfo.modelName, "templateName")) {
      data.templateName = templateName ? String(templateName) : null;
    }

    if (modelHasField(modelInfo.modelName, "numberId")) data.numberId = numberId ? String(numberId) : null;

    if (modelHasField(modelInfo.modelName, "scheduleAt")) {
      data.scheduleAt = scheduleAt ? new Date(scheduleAt) : null;
    }

    if (modelHasField(modelInfo.modelName, "metadata")) data.metadata = metadata ?? undefined;

    const item = await modelInfo.model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error(
      { err: err?.message || err, stack: err?.stack, body: req.body, model: modelInfo },
      "❌ campaignsRouter POST / failed"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// PATCH /outbound/campaigns/:id
// ======================================================
router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const modelInfo = resolveModel();
  try {
    if (!assertPrisma(res, modelInfo)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");

    // garante que pertence ao tenant/canal
    const guardWhere = { id, ...buildWhere({ modelName: modelInfo.modelName, tenantId, channel: "whatsapp" }) };

    const existing = await modelInfo.model.findFirst({
      where: guardWhere,
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.name !== undefined && modelHasField(modelInfo.modelName, "name")) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined && modelHasField(modelInfo.modelName, "status")) data.status = String(req.body.status);

    // compat templateId/templateName
    if (req.body?.templateId !== undefined && modelHasField(modelInfo.modelName, "templateId"))
      data.templateId = req.body.templateId ? String(req.body.templateId) : null;
    if (req.body?.templateName !== undefined && modelHasField(modelInfo.modelName, "templateName"))
      data.templateName = req.body.templateName ? String(req.body.templateName) : null;

    if (req.body?.numberId !== undefined && modelHasField(modelInfo.modelName, "numberId"))
      data.numberId = req.body.numberId ? String(req.body.numberId) : null;

    if (req.body?.scheduleAt !== undefined && modelHasField(modelInfo.modelName, "scheduleAt"))
      data.scheduleAt = req.body.scheduleAt ? new Date(req.body.scheduleAt) : null;

    if (req.body?.metadata !== undefined && modelHasField(modelInfo.modelName, "metadata")) data.metadata = req.body.metadata;
    if (req.body?.audience !== undefined && modelHasField(modelInfo.modelName, "audience")) data.audience = req.body.audience;
    if (req.body?.stats !== undefined && modelHasField(modelInfo.modelName, "stats")) data.stats = req.body.stats;

    // update seguro: se existir unique composto tenantId+id, usamos; senão fazemos update "por id" (mas já validamos o guard)
    const item = await modelInfo.model.update({
      where: { id },
      data
    });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error(
      { err: err?.message || err, stack: err?.stack, body: req.body, model: modelInfo },
      "❌ campaignsRouter PATCH /:id failed"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
