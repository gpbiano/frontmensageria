// backend/src/outbound/templatesRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Templates – espelho da Meta (WhatsApp)

import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

// Lê env sempre “atualizado” (não congela no import)
function getWhatsAppEnv() {
  const WABA_ID = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const WHATSAPP_TOKEN = String(process.env.WHATSAPP_TOKEN || "").trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  const v = apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}`;
  return { WABA_ID, WHATSAPP_TOKEN, apiVersion: v };
}

function ensureWhatsAppEnv(res) {
  const { WABA_ID, WHATSAPP_TOKEN } = getWhatsAppEnv();

  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      { hasWaba: !!WABA_ID, hasToken: !!WHATSAPP_TOKEN },
      "⚠️ Templates: WABA_ID/WHATSAPP_TOKEN ausentes"
    );

    res.status(500).json({
      error:
        "Configuração do WhatsApp não encontrada. Verifique WABA_ID/WHATSAPP_WABA_ID e WHATSAPP_TOKEN no .env."
    });
    return false;
  }

  return true;
}

/* ============================================================
   GET /outbound/templates
   Lista templates do banco (por tenant)
   ============================================================ */
router.get("/", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const items = await prisma.outboundTemplate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    // Mantém uma forma “compatível” com a UI antiga
    const templates = items.map((t) => {
      const raw = t?.metadata?.raw || null;
      const content = t?.content || null;

      return {
        id: t.id,
        name: t.name,
        category: raw?.category || t?.metadata?.category || null,
        language: t.language || raw?.language || null,
        status: t.status || raw?.status || null,
        quality:
          raw?.quality_score?.quality_score ||
          raw?.quality_score ||
          t?.metadata?.quality ||
          null,
        hasFlow: (() => {
          const comps = raw?.components || content?.components || [];
          if (!Array.isArray(comps)) return false;
          return comps.some(
            (c) =>
              c?.type === "BUTTONS" &&
              Array.isArray(c?.buttons) &&
              c.buttons.some((b) => b?.type === "FLOW" || b?.button_type === "FLOW" || b?.flow_id)
          );
        })(),
        components: raw?.components || content?.components || [],
        latestVersion: raw?.latest_template || t?.metadata?.latest_template || null,
        rejectedReason: raw?.rejected_reason || t?.metadata?.rejected_reason || null,
        updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : null,
        raw
      };
    });

    return res.json(templates);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ Templates GET / failed");
    return res.status(500).json({ error: "Erro ao carregar templates." });
  }
});

/* ============================================================
   POST /outbound/templates/sync
   Puxa da Meta e faz UPSERT no Prisma (por tenant)
   ============================================================ */
router.post("/sync", async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

  if (!ensureWhatsAppEnv(res)) return;

  const { WABA_ID, WHATSAPP_TOKEN, apiVersion } = getWhatsAppEnv();

  try {
    const url = new URL(`https://graph.facebook.com/${apiVersion}/${WABA_ID}/message_templates`);

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

    const graphRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    const graphJson = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok) {
      logger.error(
        { status: graphRes.status, graphJson },
        "❌ Erro ao consultar message_templates na Meta"
      );
      return res.status(502).json({
        error: "Falha ao consultar a API do WhatsApp (Meta) para templates.",
        details: graphJson
      });
    }

    const now = new Date();

    const incoming = Array.isArray(graphJson?.data) ? graphJson.data : [];
    const templates = incoming.map((tpl) => ({
      id: tpl?.id || null,
      name: String(tpl?.name || "").trim(),
      category: tpl?.category || null,
      language: tpl?.language || null,
      status: tpl?.status || null,
      quality:
        tpl?.quality_score?.quality_score ||
        tpl?.quality_score ||
        null,
      components: Array.isArray(tpl?.components) ? tpl.components : [],
      latest_template: tpl?.latest_template || null,
      rejected_reason: tpl?.rejected_reason || null,
      raw: tpl
    })).filter((t) => t.name);

    // UPSERT por (tenantId, channel, name)
    const results = [];
    for (const t of templates) {
      const up = await prisma.outboundTemplate.upsert({
        where: {
          tenantId_channel_name: {
            tenantId,
            channel: "whatsapp",
            name: t.name
          }
        },
        create: {
          tenantId,
          channel: "whatsapp",
          name: t.name,
          language: t.language || null,
          status: String(t.status || "draft").toLowerCase(),
          content: {
            components: t.components,
            category: t.category,
            language: t.language
          },
          metadata: {
            source: "meta",
            metaTemplateId: t.id,
            category: t.category,
            quality: t.quality,
            rejected_reason: t.rejected_reason,
            latest_template: t.latest_template,
            syncedAt: now.toISOString(),
            raw: t.raw
          }
        },
        update: {
          language: t.language || null,
          status: String(t.status || "draft").toLowerCase(),
          content: {
            components: t.components,
            category: t.category,
            language: t.language
          },
          metadata: {
            source: "meta",
            metaTemplateId: t.id,
            category: t.category,
            quality: t.quality,
            rejected_reason: t.rejected_reason,
            latest_template: t.latest_template,
            syncedAt: now.toISOString(),
            raw: t.raw
          }
        }
      });

      results.push(up);
    }

    logger.info(
      { tenantId, count: results.length },
      "✅ Templates sincronizados (Prisma-first)"
    );

    return res.json({
      success: true,
      tenantId,
      count: results.length,
      templates: results
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ Erro interno ao sincronizar templates");
    return res.status(500).json({ error: "Erro interno ao sincronizar templates." });
  }
});

export default router;
