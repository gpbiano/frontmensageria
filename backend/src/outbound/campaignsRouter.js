// backend/src/outbound/campaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/campaigns

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/* =========================
 * Helpers
 * ========================= */
function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
}
function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    // em dúvida, não bloqueia (comportamento “best effort”)
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
    res
      .status(503)
      .json({ ok: false, error: "prisma_model_missing", details: { expectedAnyOf: candidates } });
    return false;
  }
  return true;
}

const MODEL_CANDIDATES = ["outboundCampaign", "OutboundCampaign", "campaign", "Campaign"];

// No teu schema, channel é obrigatório. Então “where base” sempre inclui channel.
function baseWhere({ tenantId, modelName }) {
  const where = {};
  if (tenantId && modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
  // ✅ força channel (campo obrigatório no schema)
  where.channel = "whatsapp";
  return where;
}

// ======================================================
// GET /outbound/campaigns
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = "OutboundCampaign";

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await model.findMany({
      where: baseWhere({ tenantId, modelName }),
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// GET /outbound/campaigns/:id
// ======================================================
router.get("/:id", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = "OutboundCampaign";

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const item = await model.findFirst({
      where: { id, ...baseWhere({ tenantId, modelName }) }
    });

    if (!item) return res.status(404).json({ ok: false, error: "not_found" });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ campaignsRouter GET /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/campaigns
// ======================================================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = "OutboundCampaign";

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { name, templateId, templateName, templateLanguage, numberId, scheduleAt, metadata } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });

    const data = {};

    // ✅ base obrigatória
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    data.channel = "whatsapp"; // ✅ SEMPRE (obrigatório no schema)

    if (modelHasField(modelName, "name")) data.name = String(name).trim();
    if (modelHasField(modelName, "status")) data.status = "draft";

    if (modelHasField(modelName, "templateId")) data.templateId = templateId ? String(templateId) : null;
    if (modelHasField(modelName, "numberId")) data.numberId = numberId ? String(numberId) : null;

    // alguns front-ends mandam templateName/templateLanguage apenas para UI
    if (modelHasField(modelName, "metadata")) {
      data.metadata = {
        ...(typeof metadata === "object" && metadata ? metadata : {}),
        ...(templateName ? { templateName: String(templateName) } : {}),
        ...(templateLanguage ? { templateLanguage: String(templateLanguage) } : {})
      };
    }

    if (modelHasField(modelName, "scheduleAt")) {
      data.scheduleAt = scheduleAt ? new Date(scheduleAt) : null;
    }

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err, body: req.body }, "❌ campaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// PATCH /outbound/campaigns/:id
// ======================================================
router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = "OutboundCampaign";

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");

    // ✅ garante que é do tenant + channel correto
    const existing = await model.findFirst({
      where: { id, ...baseWhere({ tenantId, modelName }) },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};

    // ✅ nunca deixa mudar channel via API
    data.channel = "whatsapp";

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
    logger.error({ err, body: req.body }, "❌ campaignsRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
