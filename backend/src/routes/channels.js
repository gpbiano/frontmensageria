import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import logger from "../logger.js";

const router = express.Router();

const CHANNELS = ["whatsapp", "webchat", "messenger", "instagram"];

function now() {
  return new Date();
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

/**
 * Normaliza saída pro frontend
 */
function shapeChannel(c) {
  return {
    id: c.channel,
    channel: c.channel,
    enabled: c.enabled,
    status: c.status,
    widgetKey: c.widgetKey || null,
    config: c.config || {},
    createdAt: c.createdAt,
    updatedAt: c.updatedAt
  };
}

/**
 * GET /settings/channels
 * Lista todos os canais do tenant (cria defaults se não existirem)
 */
router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      // garante todos os canais base
      for (const ch of CHANNELS) {
        await prisma.channelConfig.upsert({
          where: {
            tenantId_channel: { tenantId, channel: ch }
          },
          update: {},
          create: {
            tenantId,
            channel: ch,
            enabled: ch === "whatsapp",
            status: ch === "whatsapp" ? "connected" : "disabled",
            widgetKey: ch === "webchat" ? newWidgetKey() : null,
            config:
              ch === "webchat"
                ? {
                    primaryColor: "#34d399",
                    position: "right",
                    buttonText: "Ajuda",
                    headerTitle: "Atendimento",
                    greeting: "Olá! Como posso ajudar?"
                  }
                : {}
          }
        });
      }

      const channels = await prisma.channelConfig.findMany({
        where: { tenantId },
        orderBy: { channel: "asc" }
      });

      return res.json(channels.map(shapeChannel));
    } catch (e) {
      logger.error({ err: e }, "❌ channels list error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * PATCH /settings/channels/:channel
 * Atualiza enabled / config
 */
router.patch(
  "/:channel",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const channel = String(req.params.channel || "").toLowerCase();

      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });
      if (!CHANNELS.includes(channel))
        return res.status(400).json({ error: "channel_invalid" });

      const patch = {};
      if (typeof req.body?.enabled === "boolean") {
        patch.enabled = req.body.enabled;
        patch.status = req.body.enabled ? "connected" : "disabled";
      }

      if (req.body?.config && typeof req.body.config === "object") {
        patch.config = req.body.config;
      }

      const updated = await prisma.channelConfig.update({
        where: {
          tenantId_channel: { tenantId, channel }
        },
        data: {
          ...patch,
          updatedAt: now()
        }
      });

      return res.json(shapeChannel(updated));
    } catch (e) {
      logger.error({ err: e }, "❌ channels update error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /settings/channels/:channel/rotate-key
 * Rotaciona widgetKey (webchat)
 */
router.post(
  "/:channel/rotate-key",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      const channel = String(req.params.channel || "").toLowerCase();

      if (channel !== "webchat") {
        return res.status(400).json({ error: "only_webchat" });
      }

      const updated = await prisma.channelConfig.update({
        where: {
          tenantId_channel: { tenantId, channel }
        },
        data: {
          widgetKey: newWidgetKey(),
          updatedAt: now()
        }
      });

      return res.json({
        widgetKey: updated.widgetKey
      });
    } catch (e) {
      logger.error({ err: e }, "❌ rotate widgetKey error");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
