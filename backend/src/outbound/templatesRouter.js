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

function getMetaEnv() {
  const wabaId = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const token =
    String(process.env.WHATSAPP_TOKEN || process.env.WABA_TOKEN || process.env.META_TOKEN || "").trim();

  // usa padrão do projeto quando existir META_GRAPH_VERSION
  const apiVersionRaw = String(
    process.env.META_GRAPH_VERSION || process.env.WHATSAPP_API_VERSION || "v22.0"
  ).trim();
  const apiVersion = apiVersionRaw.startsWith("v") ? apiVersionRaw : `v${apiVersionRaw}`;

  return { wabaId, token, apiVersion };
}

// tenta nomes comuns
const MODEL_CANDIDATES = ["outboundTemplate", "OutboundTemplate", "template", "Template"];

// ======================================================
// GET /outbound/templates
// ======================================================
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

// ======================================================
// POST /outbound/templates/sync
// ======================================================
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { wabaId, token, apiVersion } = getMetaEnv();
    if (!wabaId || !token) {
      return res.status(500).json({
        ok: false,
        error: "missing_meta_env",
        details: {
          requiredAnyOf: [
            "WABA_ID or WHATSAPP_WABA_ID",
            "WHATSAPP_TOKEN (or WABA_TOKEN or META_TOKEN)"
          ],
          got: { wabaId: !!wabaId, token: !!token, apiVersion }
        }
      });
    }

    // ✅ paginação (Meta costuma paginar). Mantém limite seguro.
    const all = [];
    let nextUrl = new URL(`https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`);
    nextUrl.searchParams.set(
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
    nextUrl.searchParams.set("limit", "200");

    const maxPages = 10; // safety
    for (let i = 0; i < maxPages && nextUrl; i++) {
      const graphRes = await fetch(nextUrl.toString(), { headers: { Authorization: `Bearer ${token}` } });
      const graphJson = await graphRes.json().catch(() => ({}));

      if (!graphRes.ok) {
        logger.error({ status: graphRes.status, graphJson }, "❌ Meta templates sync failed");
        return res.status(502).json({ ok: false, error: "meta_api_error", details: graphJson });
      }

      const pageData = Array.isArray(graphJson?.data) ? graphJson.data : [];
      all.push(...pageData);

      const next = graphJson?.paging?.next ? String(graphJson.paging.next) : "";
      nextUrl = next ? new URL(next) : null;
    }

    const nowIso = new Date().toISOString();

    // ✅ Upsert robusto:
    // 1) tenta unique composto "tenantId_channel_name" se existir
    // 2) senão: tenta updateMany+create (evita P2002 em massa e evita quebrar a transação)
    const hasDirect = model === prisma.outboundTemplate && !!prisma?.outboundTemplate;
    const canUpsertCompound = hasDirect && typeof prisma.outboundTemplate?.upsert === "function";

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const tpl of all) {
      const name = String(tpl?.name || "").trim();
      if (!name) {
        skipped++;
        continue;
      }

      const create = {};
      const update = {};

      if (modelHasField(modelName, "tenantId")) create.tenantId = tenantId;

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

      // 🔥 Cuidado: quality_score varia muito de shape. Guardamos raw.
      const contentObj = {
        metaTemplateId: tpl?.id || null,
        category: tpl?.category || null,
        language: tpl?.language || null,
        status: tpl?.status || null,
        rejectedReason: tpl?.rejected_reason || null,
        components: Array.isArray(tpl?.components) ? tpl.components : [],
        latestTemplate: tpl?.latest_template || null,
        qualityScore: tpl?.quality_score || null
      };

      if (modelHasField(modelName, "content")) {
        create.content = contentObj;
        update.content = contentObj;
      }

      if (modelHasField(modelName, "metadata")) {
        create.metadata = { raw: tpl, syncedAt: nowIso };
        update.metadata = { raw: tpl, syncedAt: nowIso };
      }

      // ✅ Estrategia de persistência (evita 500 por P2002 dentro de transaction)
      try {
        if (canUpsertCompound) {
          // unique composto padrão esperado
          const row = await prisma.outboundTemplate.upsert({
            where: { tenantId_channel_name: { tenantId, channel: "whatsapp", name } },
            create,
            update
          });
          if (row) updated++; // upsert não informa se criou; contamos como updated “best effort”
          continue;
        }

        // fallback genérico sem upsert: tenta atualizar, se não atualizou, cria
        const where = {};
        if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
        if (modelHasField(modelName, "channel")) where.channel = "whatsapp";
        if (modelHasField(modelName, "name")) where.name = name;

        // se não tiver os campos pra "where", só tenta create e ignora duplicata
        const canWhere = Object.keys(where).length >= 2 && where.name;

        if (canWhere && typeof model.updateMany === "function") {
          const upd = await model.updateMany({ where, data: update });
          if (upd?.count > 0) {
            updated++;
            continue;
          }
        }

        await model.create({ data: create });
        created++;
      } catch (e) {
        const msg = String(e?.message || e);
        // ignora duplicata (P2002) e segue, não derruba o sync
        if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
          skipped++;
          continue;
        }
        logger.error({ err: msg, tplName: name }, "❌ templatesRouter sync persist failed");
        // não mata o sync inteiro por 1 template ruim
        skipped++;
      }
    }

    // retorna lista atual
    const whereList = {};
    if (modelHasField(modelName, "tenantId")) whereList.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) whereList.channel = "whatsapp";

    const items = await model.findMany({
      where: whereList,
      orderBy: modelHasField(modelName, "updatedAt") ? { updatedAt: "desc" } : undefined
    });

    return res.json({
      ok: true,
      fetched: all.length,
      created,
      updated,
      skipped,
      count: items.length,
      items
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
