// backend/src/outbound/templatesRouter.js
// ✅ PRISMA-FIRST (compatível com schema atual do OutboundTemplate)
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
function getTenantId(req) {
  const tid = req?.tenant?.id || req?.tenantId || req?.user?.tenantId || null;
  return tid ? String(tid).trim() : null;
}

function assertPrisma(res) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!prisma?.outboundTemplate) {
    res.status(503).json({ ok: false, error: "prisma_model_missing", details: { expected: "OutboundTemplate" } });
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

function safeStr(x) {
  return String(x ?? "").trim();
}

function safeObj(x) {
  return x && typeof x === "object" ? x : {};
}

function extractBodyTextFromComponents(components) {
  const arr = Array.isArray(components) ? components : [];
  const body = arr.find((c) => String(c?.type || "").toUpperCase() === "BODY");
  return safeStr(body?.text) || "";
}

function normalizeQualityFromTpl(tpl) {
  // Meta pode variar: quality_score normalmente é objeto
  // Tentamos vários caminhos e guardamos o "melhor"
  const qs = safeObj(tpl?.quality_score);
  const q =
    safeStr(qs?.score) ||
    safeStr(qs?.quality_score) ||
    safeStr(qs?.rating) ||
    safeStr(tpl?.quality_rating) ||
    "";
  return q || null;
}

// Para UI: devolve campos derivados mesmo sem existirem no schema
function enrichTemplateForUi(item) {
  const content = safeObj(item?.content);
  const raw = safeObj(content?.raw || content); // aceitamos content como raw completo
  const components = Array.isArray(raw?.components) ? raw.components : Array.isArray(content?.components) ? content.components : [];

  const category = safeStr(raw?.category || content?.category) || null;
  const rejectedReason = safeStr(raw?.rejected_reason || content?.rejectedReason) || null;

  const quality =
    normalizeQualityFromTpl(raw) ||
    normalizeQualityFromTpl(content) ||
    (safeStr(safeObj(content?.qualityScore)?.score) ? safeStr(safeObj(content?.qualityScore)?.score) : null);

  const metaTemplateId = safeStr(raw?.id || content?.metaTemplateId) || null;

  const contentText = safeStr(item?.contentText) || extractBodyTextFromComponents(components);

  return {
    ...item,
    // campos extras pra UI (não persistidos como colunas)
    metaTemplateId,
    category,
    quality,
    rejectedReason,
    contentText,
    // ajuda a UI se quiser renderizar components
    components
  };
}

/* =========================
 * GET /outbound/templates
 * ========================= */
router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });
    if (!assertPrisma(res)) return;

    // Seu schema tem channel obrigatório, então filtra direto
    const items = await prisma.outboundTemplate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    // ✅ devolve enriquecido pra UI
    const enriched = items.map(enrichTemplateForUi);

    return res.json({ ok: true, items: enriched, templates: enriched, count: enriched.length });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* =========================
 * POST /outbound/templates/sync
 * ========================= */
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });
    if (!assertPrisma(res)) return;

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

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const tpl of all) {
      const name = safeStr(tpl?.name);
      if (!name) {
        skipped++;
        continue;
      }

      const channel = "whatsapp";

      const rawStatus = safeStr(tpl?.status) || "UNKNOWN";
      const statusLower = rawStatus.toLowerCase(); // approved / rejected / paused / etc.

      const language = tpl?.language ? String(tpl.language) : null;

      const components = Array.isArray(tpl?.components) ? tpl.components : [];
      const contentText = extractBodyTextFromComponents(components);

      // ✅ content vai com TUDO que a UI precisa (categoria, quality, components, etc.)
      // Guardamos também "raw" pra facilitar debug e compatibilidade futura
      const content = {
        raw: tpl,
        id: tpl?.id || null,
        name,
        category: tpl?.category || null,
        language: tpl?.language || null,
        status: tpl?.status || null,
        rejected_reason: tpl?.rejected_reason || null,
        quality_score: tpl?.quality_score || null,
        components,
        latest_template: tpl?.latest_template || null,
        syncedAt: nowIso
      };

      const metadata = {
        syncedAt: nowIso,
        source: "meta_graph",
        wabaId
      };

      try {
        // ✅ upsert pelo unique composto do schema: tenantId + channel + name
        // Prisma gera o input "tenantId_channel_name"
        // (se seu client estiver gerando outro nome, me avisa que eu ajusto)
        const exists = await prisma.outboundTemplate.findFirst({ where: { tenantId, channel, name } });

        if (exists?.id) {
          await prisma.outboundTemplate.update({
            where: { id: exists.id },
            data: {
              language,
              status: statusLower,
              content,
              contentText,
              metadata
            }
          });
          updated++;
        } else {
          await prisma.outboundTemplate.create({
            data: {
              tenantId,
              channel,
              name,
              language,
              status: statusLower,
              content,
              contentText,
              metadata
            }
          });
          created++;
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
          skipped++;
          continue;
        }
        logger.error({ err: msg, tplName: name }, "❌ templatesRouter sync persist failed");
        skipped++;
      }
    }

    const items = await prisma.outboundTemplate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    const enriched = items.map(enrichTemplateForUi);

    return res.json({
      ok: true,
      fetched: all.length,
      created,
      updated,
      skipped,
      items: enriched,
      templates: enriched,
      count: enriched.length
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
