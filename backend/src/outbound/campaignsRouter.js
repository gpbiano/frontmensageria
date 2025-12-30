// backend/src/outbound/campaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

const MODEL_CANDIDATES = [
  { delegateKey: "outboundCampaign", modelName: "OutboundCampaign" },
  { delegateKey: "campaign", modelName: "Campaign" },

  // fallback (caso gerado diferente)
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

/**
 * ✅ FIX REAL (prod-safe):
 * - usa prisma._runtimeDataModel (existe no runtime do Prisma)
 * - fallback para _dmmf se existir
 * - se não conseguir inspecionar, assume true (não quebra)
 */
function modelHasField(modelName, field) {
  try {
    const rt = prisma?._runtimeDataModel?.models?.[modelName];
    if (rt?.fields) return !!rt.fields[field];
  } catch {}
  try {
    const models = prisma?._dmmf?.datamodel?.models || [];
    const m = models.find((x) => x.name === modelName);
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
    logger.error({ err: err?.message || err, stack: err?.stack }, "❌ campaignsRouter GET / failed");
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
    logger.error({ err: err?.message || err, stack: err?.stack }, "❌ campaignsRouter GET /:id failed");
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

    const { name, templateId, templateName, numberId, metadata } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ ok: false, error: "name_required" });

    const data = {};

    if (modelHasField(modelInfo.modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelInfo.modelName, "channel")) data.channel = "whatsapp";
    if (modelHasField(modelInfo.modelName, "name")) data.name = String(name).trim();
    if (modelHasField(modelInfo.modelName, "status")) data.status = "draft";

    /**
     * ✅ Compat com o front:
     * - teu front envia templateName (string)
     * - teu schema tem templateId (String?)
     * Então: se não vier templateId, salvamos templateName dentro de templateId.
     */
    if (modelHasField(modelInfo.modelName, "templateId")) {
      const finalTpl = templateId || templateName || null;
      data.templateId = finalTpl ? String(finalTpl) : null;
    }

    if (modelHasField(modelInfo.modelName, "numberId")) {
      data.numberId = numberId ? String(numberId) : null;
    }

    if (modelHasField(modelInfo.modelName, "metadata")) data.metadata = metadata ?? undefined;

    const item = await modelInfo.model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    // ✅ aqui vai sair o erro real do Prisma no log
    logger.error(
      { err: err?.message || err, stack: err?.stack, body: req.body },
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
    const guardWhere = { id, ...buildWhere({ modelName: modelInfo.modelName, tenantId, channel: "whatsapp" }) };

    const existing = await modelInfo.model.findFirst({ where: guardWhere, select: { id: true } });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};
    if (req.body?.name !== undefined && modelHasField(modelInfo.modelName, "name")) data.name = String(req.body.name).trim();
    if (req.body?.status !== undefined && modelHasField(modelInfo.modelName, "status")) data.status = String(req.body.status);

    if (req.body?.templateId !== undefined && modelHasField(modelInfo.modelName, "templateId"))
      data.templateId = req.body.templateId ? String(req.body.templateId) : null;

    // compat: se vier templateName, joga em templateId (schema não tem templateName)
    if (req.body?.templateName !== undefined && modelHasField(modelInfo.modelName, "templateId"))
      data.templateId = req.body.templateName ? String(req.body.templateName) : null;

    if (req.body?.numberId !== undefined && modelHasField(modelInfo.modelName, "numberId"))
      data.numberId = req.body.numberId ? String(req.body.numberId) : null;

    if (req.body?.metadata !== undefined && modelHasField(modelInfo.modelName, "metadata")) data.metadata = req.body.metadata;
    if (req.body?.audience !== undefined && modelHasField(modelInfo.modelName, "audience")) data.audience = req.body.audience;
    if (req.body?.stats !== undefined && modelHasField(modelInfo.modelName, "stats")) data.stats = req.body.stats;

    const item = await modelInfo.model.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error(
      { err: err?.message || err, stack: err?.stack, body: req.body },
      "❌ campaignsRouter PATCH /:id failed"
    );
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
