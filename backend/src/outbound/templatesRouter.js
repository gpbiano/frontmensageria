// backend/src/outbound/templatesRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/templates

import express from "express";
import fetch from "node-fetch";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function getMetaEnv() {
  const wabaId = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();
  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v22.0").trim();
  return { wabaId, token, apiVersion: apiVersion.startsWith("v") ? apiVersion : `v${apiVersion}` };
}

router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const items = await prisma.outboundTemplate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const { wabaId, token, apiVersion } = getMetaEnv();

  if (!wabaId || !token) {
    return res.status(500).json({
      ok: false,
      error: "missing_meta_env",
      details: "Defina WABA_ID/WHATSAPP_WABA_ID e WHATSAPP_TOKEN no backend."
    });
  }

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

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

    const graphRes = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` }
    });

    const graphJson = await graphRes.json().catch(() => ({}));

    if (!graphRes.ok) {
      logger.error({ status: graphRes.status, graphJson }, "❌ Meta templates sync failed");
      return res.status(502).json({
        ok: false,
        error: "meta_api_error",
        details: graphJson
      });
    }

    const data = Array.isArray(graphJson?.data) ? graphJson.data : [];
    const now = new Date();

    // Upsert por @@unique([tenantId, channel, name])
    const ops = data.map((tpl) => {
      const name = String(tpl?.name || "").trim();
      const language = tpl?.language ? String(tpl.language) : null;

      const content = {
        category: tpl?.category || null,
        status: tpl?.status || null,
        quality: tpl?.quality_score?.quality_score || null,
        rejectedReason: tpl?.rejected_reason || null,
        components: tpl?.components || [],
        latestTemplate: tpl?.latest_template || null,
        metaTemplateId: tpl?.id || null
      };

      return prisma.outboundTemplate.upsert({
        where: { tenantId_channel_name: { tenantId, channel: "whatsapp", name } },
        create: {
          tenantId,
          channel: "whatsapp",
          name,
          language,
          status: tpl?.status ? String(tpl.status).toLowerCase() : "draft",
          content,
          metadata: { raw: tpl, syncedAt: now.toISOString() }
        },
        update: {
          language,
          status: tpl?.status ? String(tpl.status).toLowerCase() : undefined,
          content,
          metadata: { raw: tpl, syncedAt: now.toISOString() },
          updatedAt: now
        }
      });
    });

    await prisma.$transaction(ops);

    const items = await prisma.outboundTemplate.findMany({
      where: { tenantId, channel: "whatsapp" },
      orderBy: { updatedAt: "desc" }
    });

    return res.json({ ok: true, count: items.length, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ templatesRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
