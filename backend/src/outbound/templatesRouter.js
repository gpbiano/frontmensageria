// backend/src/outbound/templatesRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/templates

import express from "express";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/* =========================
 * Prisma model resolver
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
    return true; // fallback: assume exists (não quebra)
  }
}
function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}
function assertPrisma(res, model, modelName) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expectedAnyOf: modelName }
    });
    return false;
  }
  return true;
}

function getMetaEnv() {
  const wabaId = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const apiVersionRaw = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  const apiVersion = apiVersionRaw.startsWith("v") ? apiVersionRaw : `v${apiVersionRaw}`;
  return { wabaId, token, apiVersion };
}

// tenta nomes comuns
const MODEL_CANDIDATES = ["outboundTemplate", "OutboundTemplate", "template", "Template"];

/**
 * GET /outbound/templates
 */
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) where.channel = "whatsapp";

    const items = await model.findMany({
      where,
      orderBy: modelHasField(modelName, "updatedAt") ? { updatedAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * POST /outbound/templates/sync
 */
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  const { wabaId, token, apiVersion } = getMetaEnv();
  if (!wabaId || !token) {
    return res.status(500).json({
      ok: false,
      error: "missing_meta_env",
      details: "Defina WABA_ID/WHATSAPP_WABA_ID e WHATSAPP_TOKEN no backend."
    });
  }

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const url = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`);
    url.searchParams.set(
      "fields",
      [
        "id",
        "name",
        "category",
        "language",
        "status",
        "quality_score",
        "components",
        "rejected_reason",
        "latest_template"
      ].join(",")
    );

    const graphRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    const graphJson = await graphRes.json().catch(() => ({}));
    if (!graphRes.ok) {
      logger.error({ status: graphRes.status, graphJson }, "❌ Meta templates sync failed");
      return res.status(502).json({ ok: false, error: "meta_api_error", details: graphJson });
    }

    const data = Array.isArray(graphJson?.data) ? graphJson.data : [];
    const now = new Date().toISOString();

    // upsert “best effort” (só seta campos que existem)
    const ops = data
      .map((tpl) => {
        const name = String(tpl?.name || "").trim();
        if (!name) return null;

        const create = {};
        const update = {};

        if (modelHasField(modelName, "tenantId")) {
          create.tenantId = tenantId;
        }
        if (modelHasField(modelName, "channel")) {
          create.channel = "whatsapp";
          update.channel = "whatsapp";
        }
        if (modelHasField(modelName, "name")) {
          create.name = name;
          update.name = name;
        }

        if (modelHasField(modelName, "language")) {
          const language = tpl?.language ? String(tpl.language) : null;
          create.language = language;
          update.language = language;
        }

        if (modelHasField(modelName, "status")) {
          const st = tpl?.status ? String(tpl.status).toLowerCase() : "draft";
          create.status = st;
          update.status = st;
        }

        if (modelHasField(modelName, "content")) {
          create.content = {
            category: tpl?.category || null,
            status: tpl?.status || null,
            quality: tpl?.quality_score?.quality_score || null,
            rejectedReason: tpl?.rejected_reason || null,
            components: tpl?.components || [],
            latestTemplate: tpl?.latest_template || null,
            metaTemplateId: tpl?.id || null
          };
          update.content = create.content;
        }

        if (modelHasField(modelName, "metadata")) {
          create.metadata = { raw: tpl, syncedAt: now };
          update.metadata = { raw: tpl, syncedAt: now };
        }

        // where composto se existir; senão fallback “create only”
        if (prisma?.outboundTemplate?.upsert && model === prisma.outboundTemplate) {
          return prisma.outboundTemplate.upsert({
            where: { tenantId_channel_name: { tenantId, channel: "whatsapp", name } },
            create,
            update
          });
        }

        // fallback: tenta create (se duplicar, ignora)
        return model.create({ data: create }).catch(() => null);
      })
      .filter(Boolean);

    if (ops.length) {
      // se for upsert real, podemos transacionar
      if (typeof prisma.$transaction === "function") await prisma.$transaction(ops);
      else await Promise.all(ops);
    }

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) where.channel = "whatsapp";

    const items = await model.findMany({
      where,
      orderBy: modelHasField(modelName, "updatedAt") ? { updatedAt: "desc" } : undefined
    });

    return res.json({ ok: true, count: items.length, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
