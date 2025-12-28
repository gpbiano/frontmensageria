// backend/src/routes/channels/instagramRouter.js
import express from "express";
import prismaMod from "../../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../../middleware/requireAuth.js";
import logger from "../../logger.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

function asObj(v) {
  return v && typeof v === "object" ? v : {};
}

/**
 * POST /settings/channels/instagram/connect
 * Body:
 * {
 *   pageId: string,
 *   instagramBusinessAccountId: string,
 *   displayName?: string,
 *   accessToken: string,
 *
 *   // opcionais (pra já alinhar com bot/inbox)
 *   botEnabled?: boolean,
 *   maxBotAttempts?: number,
 *   transferKeywords?: string[]
 * }
 */
router.post(
  "/connect",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const pageId = String(req.body?.pageId || "").trim();
      const igBusinessId = String(req.body?.instagramBusinessAccountId || "").trim();
      const displayName = String(req.body?.displayName || "").trim();
      const accessToken = String(req.body?.accessToken || "").trim();

      if (!pageId) return res.status(400).json({ error: "pageId_required" });
      if (!igBusinessId) {
        return res.status(400).json({ error: "instagramBusinessAccountId_required" });
      }
      if (!accessToken) return res.status(400).json({ error: "accessToken_required" });

      // lê config atual (se existir)
      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId: String(tenantId), channel: "instagram" } }
      });

      const curCfg = asObj(current?.config);

      // merge seguro
      const mergedConfig = {
        ...curCfg,

        // ids úteis pro webhook / roteamento
        instagramBusinessId: igBusinessId,

        // defaults / tracking
        connectedAt: new Date().toISOString()
      };

      // opcionais pra alinhar com bot/inbox (se você mandar no body)
      if (req.body?.botEnabled !== undefined) mergedConfig.botEnabled = req.body.botEnabled === true;

      if (req.body?.maxBotAttempts !== undefined) {
        const n = Number(req.body.maxBotAttempts);
        if (Number.isFinite(n) && n >= 1 && n <= 50) mergedConfig.maxBotAttempts = Math.floor(n);
      }

      if (req.body?.transferKeywords !== undefined) {
        if (Array.isArray(req.body.transferKeywords)) {
          mergedConfig.transferKeywords = Array.from(
            new Set(
              req.body.transferKeywords
                .map((s) => String(s || "").trim())
                .filter(Boolean)
            )
          ).slice(0, 50);
        }
      }

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId: String(tenantId), channel: "instagram" } },
        update: {
          enabled: true,
          status: "connected",
          pageId,
          accessToken,
          displayName: displayName || current?.displayName || "Instagram",
          config: mergedConfig,
          updatedAt: new Date()
        },
        create: {
          tenantId: String(tenantId),
          channel: "instagram",
          enabled: true,
          status: "connected",
          widgetKey: null,
          pageId,
          accessToken,
          displayName: displayName || "Instagram",
          config: mergedConfig
        }
      });

      return res.json({ ok: true, instagram: updated });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/instagram/connect");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
