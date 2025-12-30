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
 * Helpers
 * ========================= */
function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
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
function getMetaEnv() {
  const wabaId = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const token = String(process.env.WHATSAPP_TOKEN || process.env.WABA_TOKEN || process.env.META_TOKEN || "").trim();
  const apiVersionRaw = String(process.env.META_GRAPH_VERSION || process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  const apiVersion = apiVersionRaw.startsWith("v") ? apiVersionRaw : `v${apiVersionRaw}`;
  return { wabaId, token, apiVersion };
}
function canonStatus(metaStatus) {
  const s = String(metaStatus || "").trim();
  return s ? s.toUpperCase() : "DRAFT";
}

const MODEL_CANDIDATES = ["outboundTemplate", "OutboundTemplate", "template", "Template"];

// ======================================================
// GET /outbound/templates
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const delegate = prisma?.outboundTemplate || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    // No teu schema, channel existe e é obrigatório → sempre filtra whatsapp
    const items = await delegate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    return res.json({ ok: true, items, templates: items, count: items.length });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/templates/sync
// ======================================================
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const delegate = prisma?.outboundTemplate || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    const { wabaId, token, apiVersion } = getMetaEnv();
    if (!wabaId || !token) {
      return res.status(500).json({
        ok: false,
        error: "missing_meta_env",
        details: "Defina WABA_ID/WHATSAPP_WABA_ID e WHATSAPP_TOKEN (ou WABA_TOKEN/META_TOKEN) no backend."
      });
    }

    // ✅ Busca Meta (com paginação)
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

    const maxPages = 10;
    for (let i = 0; i < maxPages && nextUrl; i++) {
      const graphRes = await fetch(nextUrl.toString(), {
        headers: { Authorization: `Bearer ${token}` }
      });

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

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const canUpsert =
      delegate === prisma.outboundTemplate && typeof prisma.outboundTemplate?.upsert === "function";

    for (const tpl of all) {
      const name = String(tpl?.name || "").trim();
      if (!name) {
        skipped++;
        continue;
      }

      const status = canonStatus(tpl?.status);

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

      // ✅ No teu schema: tenantId + channel + name são críticos
      const create = {
        tenantId,
        channel: "whatsapp",
        name,
        language: tpl?.language ? String(tpl.language) : null,
        status,
        content: contentObj,
        metadata: { raw: tpl, metaStatus: status, syncedAt: nowIso }
      };

      const updateData = {
        channel: "whatsapp",
        name,
        language: tpl?.language ? String(tpl.language) : null,
        status,
        content: contentObj,
        metadata: { raw: tpl, metaStatus: status, syncedAt: nowIso }
      };

      try {
        if (canUpsert) {
          await prisma.outboundTemplate.upsert({
            where: { tenantId_channel_name: { tenantId, channel: "whatsapp", name } },
            create,
            update: updateData
          });
          updated++;
        } else if (typeof delegate.updateMany === "function") {
          const upd = await delegate.updateMany({
            where: { tenantId, channel: "whatsapp", name },
            data: updateData
          });

          if (upd?.count > 0) updated++;
          else {
            await delegate.create({ data: create });
            created++;
          }
        } else {
          await delegate.create({ data: create });
          created++;
        }
      } catch (e) {
        const msg = String(e?.message || e);
        // duplicidade por unique(tenantId, channel, name)
        if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
          skipped++;
          continue;
        }
        logger.error({ err: msg, tplName: name }, "❌ templatesRouter sync persist failed");
        skipped++;
      }
    }

    const items = await delegate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    return res.json({
      ok: true,
      fetched: all.length,
      created,
      updated,
      skipped,
      items,
      templates: items,
      count: items.length
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
