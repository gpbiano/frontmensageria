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

/**
 * POST /settings/channels/instagram/connect
 * Body:
 * {
 *   pageId: string,
 *   instagramBusinessAccountId: string,
 *   displayName?: string,
 *   accessToken: string
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
      if (!igBusinessId) return res.status(400).json({ error: "instagramBusinessAccountId_required" });
      if (!accessToken) return res.status(400).json({ error: "accessToken_required" });

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "instagram" } }
      });

      const mergedConfig = {
        ...(current?.config || {}),
        instagramBusinessId: igBusinessId,
        connectedAt: new Date().toISOString()
      };

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "instagram" } },
        update: {
          enabled: true,
          status: "connected",
          pageId,
          accessToken,
          displayName: displayName || "Instagram",
          config: mergedConfig,
          updatedAt: new Date()
        },
        create: {
          tenantId,
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
