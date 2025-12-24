import express from "express";
import prismaMod from "../../lib/prisma.js";
import { requireAuth } from "../../../middleware/requireAuth.js";
import logger from "../../../logger.js";

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
router.post("/connect", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ error: "Tenant não identificado." });

    const pageId = String(req.body?.pageId || "").trim();
    const igBusinessId = String(req.body?.instagramBusinessAccountId || "").trim();
    const displayName = String(req.body?.displayName || "").trim();
    const accessToken = String(req.body?.accessToken || "").trim();

    if (!pageId || !igBusinessId || !accessToken) {
      return res.status(400).json({
        error: "Dados incompletos. Envie pageId, instagramBusinessAccountId e accessToken."
      });
    }

    const channel = await prisma.channelConfig.upsert({
      where: {
        tenantId_channel: { tenantId, channel: "instagram" }
      },
      update: {
        enabled: true,
        status: "connected",
        pageId,
        accessToken,
        displayName: displayName || undefined,
        config: {
          instagramBusinessAccountId: igBusinessId
        }
      },
      create: {
        tenantId,
        channel: "instagram",
        enabled: true,
        status: "connected",
        pageId,
        accessToken,
        displayName: displayName || null,
        config: {
          instagramBusinessAccountId: igBusinessId
        }
      }
    });

    logger.info(
      { tenantId, pageId, igBusinessId },
      "✅ Instagram channel connected"
    );

    return res.json({ ok: true, channel });
  } catch (e) {
    logger.error({ err: String(e) }, "❌ Instagram connect failed");
    return res.status(500).json({ error: "Erro ao conectar Instagram." });
  }
});

/**
 * DELETE /settings/channels/instagram
 */
router.delete("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(401).json({ error: "Tenant não identificado." });

    await prisma.channelConfig.upsert({
      where: { tenantId_channel: { tenantId, channel: "instagram" } },
      update: {
        enabled: false,
        status: "disconnected",
        accessToken: null,
        pageId: null,
        displayName: null,
        config: null
      },
      create: {
        tenantId,
        channel: "instagram",
        enabled: false,
        status: "disconnected"
      }
    });

    return res.json({ ok: true });
  } catch (e) {
    logger.error({ err: String(e) }, "❌ Instagram disconnect failed");
    return res.status(500).json({ error: "Erro ao desconectar Instagram." });
  }
});

export default router;
