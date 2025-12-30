// backend/src/outbound/templatesRouter.js
// Base: /outbound/templates

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

// =========================
// Prisma helpers
// =========================
function resolveModel() {
  return prisma?.outboundTemplate || prisma?.OutboundTemplate || null;
}

function getModelName() {
  return "OutboundTemplate";
}

function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return false;
  }
}

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res, model) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expected: "outboundTemplate|OutboundTemplate" }
    });
    return false;
  }
  return true;
}

function safeObj(x) {
  return x && typeof x === "object" ? x : {};
}

// =========================
// LIST templates
// =========================
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const channel = String(req.query.channel || "").trim(); // sms | whatsapp
    const status = String(req.query.status || "").trim();   // draft | active | archived

    const where = { tenantId };

    if (channel) where.channel = channel;
    if (status) where.status = status;

    const items = await model.findMany({
      where,
      orderBy: { updatedAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// GET template by id
// =========================
router.get("/:id", requireAuth, async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const item = await model.findFirst({
      where: { id, tenantId }
    });

    if (!item) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// CREATE template
// =========================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const channel = String(req.body?.channel || "").trim(); // sms | whatsapp
    const status = String(req.body?.status || "draft").trim();

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!["sms", "whatsapp"].includes(channel)) {
      return res.status(400).json({ ok: false, error: "invalid_channel" });
    }

    const data = {
      tenantId,
      name,
      channel,
      status
    };

    // ✅ SMS simples
    if (channel === "sms" && modelHasField(modelName, "contentText")) {
      data.contentText = String(req.body?.contentText || "").trim();
      if (!data.contentText) {
        return res.status(400).json({ ok: false, error: "contentText_required" });
      }
    }

    // ✅ WhatsApp ou templates estruturados
    if (modelHasField(modelName, "content")) {
      if (req.body?.content && typeof req.body.content === "object") {
        data.content = req.body.content;
      }
    }

    if (modelHasField(modelName, "metadata")) {
      data.metadata = safeObj(req.body?.metadata);
    }

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ ok: false, error: "template_name_already_exists" });
    }

    logger.error({ err: err?.message || err, body: req.body }, "❌ templatesRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// UPDATE template
// =========================
router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await model.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};

    if (typeof req.body?.name === "string") data.name = req.body.name.trim();
    if (typeof req.body?.status === "string") data.status = req.body.status.trim();

    if (existing.channel === "sms" && modelHasField(modelName, "contentText")) {
      if (typeof req.body?.contentText === "string") {
        data.contentText = req.body.contentText.trim();
      }
    }

    if (modelHasField(modelName, "content") && typeof req.body?.content === "object") {
      data.content = req.body.content;
    }

    if (modelHasField(modelName, "metadata")) {
      data.metadata = safeObj(req.body?.metadata);
    }

    const item = await model.update({
      where: { id },
      data
    });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ templatesRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// ARCHIVE (soft delete)
// =========================
router.patch("/:id/archive", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await model.findFirst({ where: { id, tenantId } });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const item = await model.update({
      where: { id },
      data: { status: "archived" }
    });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter PATCH /:id/archive failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
