// backend/src/outbound/outboundRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Hub Outbound (MVP): health + compat endpoints (sem storage legado)

import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function normalizeApiVersion(v) {
  const s = String(v || "").trim();
  if (!s) return "v22.0";
  return s.startsWith("v") ? s : `v${s}`;
}

// Lê env no momento do request (evita env “stale”)
function getWhatsAppEnv() {
  const WABA_ID = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const WHATSAPP_TOKEN = String(process.env.WHATSAPP_TOKEN || "").trim();
  const apiVersion = normalizeApiVersion(process.env.WHATSAPP_API_VERSION || "v22.0");
  return { WABA_ID, WHATSAPP_TOKEN, apiVersion };
}

function ensureWhatsAppEnv(res) {
  const { WABA_ID, WHATSAPP_TOKEN } = getWhatsAppEnv();
  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      { hasWaba: !!WABA_ID, hasToken: !!WHATSAPP_TOKEN },
      "⚠️ Outbound: WABA_ID/WHATSAPP_TOKEN ausentes"
    );
    res.status(500).json({
      error:
        "Configuração do WhatsApp não encontrada. Verifique WABA_ID/WHATSAPP_WABA_ID e WHATSAPP_TOKEN no .env."
    });
    return false;
  }
  return true;
}

/**
 * GET /outbound
 * Hub do módulo outbound (status + contadores)
 */
router.get("/", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const [templates, numbers, campaigns, optouts] = await Promise.all([
      prisma.outboundTemplate.count({ where: { tenantId } }),
      prisma.outboundNumber.count({ where: { tenantId } }),
      prisma.outboundCampaign.count({ where: { tenantId } }),
      prisma.optOutEntry.count({ where: { tenantId } })
    ]);

    return res.json({
      ok: true,
      tenantId,
      counters: { templates, numbers, campaigns, optouts },
      env: {
        hasWaba: !!(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID),
        hasWhatsappToken: !!process.env.WHATSAPP_TOKEN,
        whatsappApiVersion: normalizeApiVersion(process.env.WHATSAPP_API_VERSION || "v22.0")
      }
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ outboundRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * GET /outbound/meta/templates
 * Consulta a Meta (não grava em lugar nenhum).
 * Útil pra debug / comparar com o banco.
 */
router.get("/meta/templates", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    if (!ensureWhatsAppEnv(res)) return;
    const { WABA_ID, WHATSAPP_TOKEN, apiVersion } = getWhatsAppEnv();

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

    const metaRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    const json = await metaRes.json().catch(() => ({}));

    if (!metaRes.ok) {
      logger.error({ status: metaRes.status, json }, "❌ Meta templates fetch failed");
      return res.status(502).json({ error: "meta_fetch_failed", details: json });
    }

    return res.json({ ok: true, tenantId, data: json.data || [] });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ outboundRouter GET /meta/templates failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /outbound/meta/health
 * Checa apenas se as credenciais/config do WhatsApp estão presentes.
 * (Sem chamada externa, sem banco.)
 */
router.get("/meta/health", (req, res) => {
  const tenantId = getTenantId(req);
  const { WABA_ID, WHATSAPP_TOKEN, apiVersion } = getWhatsAppEnv();

  return res.json({
    ok: true,
    tenantId: tenantId || null,
    hasWaba: !!WABA_ID,
    hasToken: !!WHATSAPP_TOKEN,
    apiVersion
  });
});

/**
 * COMPAT: se existia algo como /outbound/templates no router legado,
 * a sua API atual já monta /outbound/templates via templatesRouter.
 * Então aqui deixamos explícito pra evitar confusão.
 */
router.get("/_routes", (_req, res) => {
  return res.json({
    ok: true,
    routes: [
      "/outbound (hub)",
      "/outbound/templates",
      "/outbound/numbers",
      "/outbound/assets",
      "/outbound/campaigns",
      "/outbound/optout",
      "/outbound/sms-campaigns",
      "/outbound/meta/templates",
      "/outbound/meta/health"
    ]
  });
});

export default router;
