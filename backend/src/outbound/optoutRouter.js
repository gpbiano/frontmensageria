// backend/src/outbound/optoutRouter.js
// ✅ PRISMA-FIRST (SEM optout.json/data.json)
// Base: /outbound/optout

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

const MODEL_CANDIDATES = ["optOutEntry", "OptOutEntry", "optoutEntry", "OptoutEntry", "optOut", "OptOut"];

function normalizeTarget(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 10) return digits;
  return s.toLowerCase();
}

router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));
    const skip = (page - 1) * limit;

    const channel = String(req.query.channel || "whatsapp");
    const q = String(req.query.query || "").trim();

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) where.channel = channel;

    if (q && (modelHasField(modelName, "target") || modelHasField(modelName, "reason"))) {
      where.OR = [];
      if (modelHasField(modelName, "target")) where.OR.push({ target: { contains: q, mode: "insensitive" } });
      if (modelHasField(modelName, "reason")) where.OR.push({ reason: { contains: q, mode: "insensitive" } });
      if (!where.OR.length) delete where.OR;
    }

    const [total, items] = await Promise.all([
      model.count({ where }),
      model.findMany({
        where,
        orderBy: modelHasField(modelName, "updatedAt") ? { updatedAt: "desc" } : undefined,
        skip,
        take: limit
      })
    ]);

    return res.json({ ok: true, page, limit, total, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter GET / failed");
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

    const channel = String(req.body?.channel || "whatsapp");
    const target = normalizeTarget(req.body?.target);
    const reason = req.body?.reason ? String(req.body.reason) : null;

    if (!target) return res.status(400).json({ ok: false, error: "target_required" });

    // se existir unique composto, tenta upsert, senão create
    let item = null;

    if (model === prisma.optOutEntry && prisma.optOutEntry?.upsert) {
      item = await prisma.optOutEntry.upsert({
        where: { tenantId_channel_target: { tenantId, channel, target } },
        create: { tenantId, channel, target, reason, isActive: true },
        update: { reason, isActive: true }
      });
    } else {
      const data = {};
      if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
      if (modelHasField(modelName, "channel")) data.channel = channel;
      if (modelHasField(modelName, "target")) data.target = target;
      if (modelHasField(modelName, "reason")) data.reason = reason;
      if (modelHasField(modelName, "isActive")) data.isActive = true;

      item = await model.create({ data });
    }

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.delete("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await model.findFirst({
      where: { id, ...(prisma?.optOutEntry ? { tenantId } : {}) },
      select: { id: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    await model.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ optoutRouter DELETE /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;

