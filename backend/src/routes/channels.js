import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

/**
 * helpers
 */
function now() {
  return new Date();
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Defaults por canal (compatível com front atual)
 */
function defaultChannel(channel) {
  if (channel === "webchat") {
    return {
      enabled: false,
      status: "disabled",
      widgetKey: newWidgetKey(),
      config: {
        primaryColor: "#34d399",
        color: "#34d399",
        position: "right",
        buttonText: "Ajuda",
        headerTitle: "Atendimento",
        title: "Atendimento",
        greeting: "Olá! Como posso ajudar?"
      }
    };
  }

  if (channel === "whatsapp") {
    return {
      enabled: true,
      status: "connected",
      config: {}
    };
  }

  return {
    enabled: false,
    status: "soon",
    config: {}
  };
}

/**
 * GET /settings/channels
 * Lista todos os canais do tenant
 */
router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  async (req, res) => {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const existing = await prisma.channelConfig.findMany({
      where: { tenantId }
    });

    const byChannel = Object.fromEntries(
      existing.map((c) => [c.channel, c])
    );

    const channels = ["whatsapp", "webchat", "messenger", "instagram"].map(
      async (ch) => {
        let row = byChannel[ch];

        if (!row) {
          const def = defaultChannel(ch);
          row = await prisma.channelConfig.create({
            data: {
              tenantId,
              channel: ch,
              enabled: def.enabled,
              status: def.status,
              widgetKey: def.widgetKey,
              config: def.config
            }
          });
        }

        return {
          id: row.channel,
          name:
            row.channel === "whatsapp"
              ? "WhatsApp Cloud API"
              : row.channel === "webchat"
              ? "Web Chat (Widget)"
              : row.channel === "messenger"
              ? "Facebook Messenger"
              : "Instagram Direct",
          description:
            row.channel === "whatsapp"
              ? "Canal oficial do WhatsApp via Meta Cloud API."
              : row.channel === "webchat"
              ? "Widget de atendimento para seu site."
              : "Em breve.",
          enabled: row.enabled,
          status: row.status,
          widgetKey: row.widgetKey,
          config: row.config || {},
          createdAt: row.createdAt,
          updatedAt: row.updatedAt
        };
      }
    );

    res.json(await Promise.all(channels));
  }
);

/**
 * PATCH /settings/channels/webchat
 * Atualiza config do widget
 */
router.patch(
  "/webchat",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const current =
      (await prisma.channelConfig.findUnique({
        where: {
          tenantId_channel: { tenantId, channel: "webchat" }
        }
      })) ||
      (await prisma.channelConfig.create({
        data: {
          tenantId,
          channel: "webchat",
          ...defaultChannel("webchat")
        }
      }));

    const patch = req.body || {};
    const nextConfig = {
      ...(current.config || {}),
      ...(patch.config || {})
    };

    // compat frontend
    if (nextConfig.primaryColor && !nextConfig.color)
      nextConfig.color = nextConfig.primaryColor;
    if (nextConfig.color && !nextConfig.primaryColor)
      nextConfig.primaryColor = nextConfig.color;

    const updated = await prisma.channelConfig.update({
      where: { id: current.id },
      data: {
        enabled:
          typeof patch.enabled === "boolean"
            ? patch.enabled
            : current.enabled,
        status:
          typeof patch.enabled === "boolean"
            ? patch.enabled
              ? "connected"
              : "disabled"
            : current.status,
        config: nextConfig,
        updatedAt: now()
      }
    });

    res.json(updated);
  }
);

/**
 * POST /settings/channels/webchat/rotate-key
 */
router.post(
  "/webchat/rotate-key",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    const tenantId = req.tenant?.id;
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const updated = await prisma.channelConfig.update({
      where: {
        tenantId_channel: { tenantId, channel: "webchat" }
      },
      data: {
        widgetKey: newWidgetKey(),
        updatedAt: now()
      }
    });

    res.json({ widgetKey: updated.widgetKey });
  }
);

export default router;
