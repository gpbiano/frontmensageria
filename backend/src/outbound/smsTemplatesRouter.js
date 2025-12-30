// backend/src/outbound/smsTemplatesRouter.js
// Base: /outbound/sms-templates
// ✅ Não interfere no WhatsApp templates router
// ✅ Prisma-first + multi-tenant
// ✅ Salva SMS em contentText (se existir) ou metadata.message (fallback)

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

function cleanStr(x, max = 1000) {
  return String(x ?? "").trim().slice(0, max);
}

function extractSmsTextFromTemplate(tpl) {
  // ordem: contentText -> metadata.message -> content.message
  if (typeof tpl?.contentText === "string" && tpl.contentText.trim()) return tpl.contentText.trim();

  const md = safeObj(tpl?.metadata);
  if (typeof md?.message === "string" && md.message.trim()) return md.message.trim();

  const content = safeObj(tpl?.content);
  if (typeof content?.message === "string" && content.message.trim()) return content.message.trim();

  return "";
}

// =========================
// LIST SMS templates
// GET /outbound/sms-templates?status=draft|active|archived&q=...
// =========================
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const status = cleanStr(req.query.status, 30);
    const q = cleanStr(req.query.q, 120);

    const where = { tenantId, channel: "sms" };
    if (status) where.status = status;

    if (q) {
      where.OR = [{ name: { contains: q, mode: "insensitive" } }];
    }

    const items = await model.findMany({
      where,
      orderBy: { updatedAt: "desc" }
    });

    // devolve também um "text" pronto pro front usar sem saber onde tá salvo
    const mapped = items.map((t) => ({
      ...t,
      text: extractSmsTextFromTemplate(t)
    }));

    return res.json({ ok: true, items: mapped });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsTemplatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// GET SMS template by id
// GET /outbound/sms-templates/:id
// =========================
router.get("/:id", requireAuth, async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const item = await model.findFirst({
      where: { id, tenantId, channel: "sms" }
    });

    if (!item) return res.status(404).json({ ok: false, error: "not_found" });

    return res.json({ ok: true, item: { ...item, text: extractSmsTextFromTemplate(item) } });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsTemplatesRouter GET /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// CREATE SMS template
// POST /outbound/sms-templates
// body: { name, text, status?, metadata? }
// =========================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = cleanStr(req.body?.name, 120);
    const text = cleanStr(req.body?.text ?? req.body?.message ?? req.body?.contentText, 1000);
    const status = cleanStr(req.body?.status || "draft", 30);

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!text) return res.status(400).json({ ok: false, error: "text_required" });

    const data = {
      tenantId,
      channel: "sms",
      name,
      status
    };

    // ✅ Onde salvar o texto (preferência: contentText, senão metadata.message, senão content.message)
    if (modelHasField(modelName, "contentText")) {
      data.contentText = text;
    } else if (modelHasField(modelName, "metadata")) {
      data.metadata = { ...safeObj(req.body?.metadata), message: text };
    } else if (modelHasField(modelName, "content")) {
      data.content = { message: text };
    }

    // opcional: metadata extra
    if (modelHasField(modelName, "metadata") && !data.metadata) {
      data.metadata = safeObj(req.body?.metadata);
    }

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item: { ...item, text } });
  } catch (err) {
    if (String(err?.code) === "P2002") {
      return res.status(409).json({ ok: false, error: "template_name_already_exists" });
    }
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsTemplatesRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// UPDATE SMS template
// PATCH /outbound/sms-templates/:id
// body: { name?, text?, status?, metadata? }
// =========================
router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await model.findFirst({
      where: { id, tenantId, channel: "sms" }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const data = {};

    if (typeof req.body?.name === "string") data.name = cleanStr(req.body.name, 120);
    if (typeof req.body?.status === "string") data.status = cleanStr(req.body.status, 30);

    const nextText = typeof req.body?.text === "string"
      ? cleanStr(req.body.text, 1000)
      : (typeof req.body?.message === "string" ? cleanStr(req.body.message, 1000) : null);

    if (nextText !== null) {
      if (modelHasField(modelName, "contentText")) {
        data.contentText = nextText;
      } else if (modelHasField(modelName, "metadata")) {
        data.metadata = { ...safeObj(existing.metadata), ...safeObj(req.body?.metadata), message: nextText };
      } else if (modelHasField(modelName, "content")) {
        data.content = { ...(safeObj(existing.content)), message: nextText };
      }
    } else if (modelHasField(modelName, "metadata") && req.body?.metadata && typeof req.body.metadata === "object") {
      data.metadata = { ...safeObj(existing.metadata), ...safeObj(req.body.metadata) };
    }

    const item = await model.update({ where: { id }, data });

    return res.json({ ok: true, item: { ...item, text: extractSmsTextFromTemplate(item) } });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsTemplatesRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// ARCHIVE (soft delete)
// PATCH /outbound/sms-templates/:id/archive
// =========================
router.patch("/:id/archive", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const existing = await model.findFirst({
      where: { id, tenantId, channel: "sms" }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const item = await model.update({
      where: { id },
      data: { status: "archived" }
    });

    return res.json({ ok: true, item: { ...item, text: extractSmsTextFromTemplate(item) } });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsTemplatesRouter PATCH /:id/archive failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
