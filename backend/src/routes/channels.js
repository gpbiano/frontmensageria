import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import logger from "../logger.js";
import fetch from "node-fetch";

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

function signState(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(raw)
    .digest("hex");
  return Buffer.from(`${raw}.${sig}`).toString("base64");
}

function verifyState(state) {
  const decoded = Buffer.from(state, "base64").toString("utf8");
  const [raw, sig] = decoded.split(".");
  const expected = crypto
    .createHmac("sha256", process.env.JWT_SECRET)
    .update(raw)
    .digest("hex");
  if (sig !== expected) throw new Error("invalid_state");
  return JSON.parse(raw);
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

      for (const ch of CHANNELS) {
        await prisma.channelConfig.upsert({
          where: { tenantId_channel: { tenantId, channel: ch } },
          update: {},
          create: {
            tenantId,
            channel: ch,
            enabled: ch === "whatsapp",
            status: ch === "whatsapp" ? "disconnected" : "disabled",
            widgetKey: ch === "webchat" ? newWidgetKey() : null,
            config: ch === "webchat"
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

      res.json(channels.map(shapeChannel));
    } catch (e) {
      logger.error(e, "❌ channels list error");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /settings/channels/whatsapp/start
 */
router.post(
  "/whatsapp/start",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);

      const state = signState({
        tenantId,
        ts: Date.now()
      });

      res.json({
        appId: process.env.META_APP_ID,
        redirectUri: process.env.META_EMBEDDED_REDIRECT_URI,
        state,
        scopes: ["whatsapp_business_messaging", "business_management"]
      });
    } catch (e) {
      logger.error(e, "❌ whatsapp start error");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

/**
 * POST /settings/channels/whatsapp/callback
 */
router.post(
  "/whatsapp/callback",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { code, state } = req.body;
      const { tenantId } = verifyState(state);

      const tokenRes = await fetch(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            redirect_uri: process.env.META_EMBEDDED_REDIRECT_URI,
            code
          })
        }
      ).then(r => r.json());

      if (!tokenRes.access_token) {
        throw new Error("token_exchange_failed");
      }

      await prisma.channelConfig.update({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        data: {
          status: "connected",
          enabled: true,
          config: {
            accessToken: tokenRes.access_token,
            connectedAt: now()
          },
          updatedAt: now()
        }
      });

      res.json({ ok: true });
    } catch (e) {
      logger.error(e, "❌ whatsapp callback error");
      res.status(500).json({ error: "whatsapp_connect_failed" });
    }
  }
);

/**
 * GET /settings/channels/whatsapp/status
 */
router.get(
  "/whatsapp/status",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    const tenantId = getTenantId(req);
    const ch = await prisma.channelConfig.findUnique({
      where: { tenantId_channel: { tenantId, channel: "whatsapp" } }
    });
    res.json(shapeChannel(ch));
  }
);

/**
 * DELETE /settings/channels/whatsapp
 */
router.delete(
  "/whatsapp",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    const tenantId = getTenantId(req);

    await prisma.channelConfig.update({
      where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
      data: {
        status: "disconnected",
        enabled: false,
        config: {},
        updatedAt: now()
      }
    });

    res.json({ ok: true });
  }
);

export default router;
