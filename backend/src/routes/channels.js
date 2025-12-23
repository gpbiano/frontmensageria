import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import {
  requireAuth,
  enforceTokenTenant,
  requireRole
} from "../middleware/requireAuth.js";
import logger from "../logger.js";
import fetch from "node-fetch";

const router = express.Router();

const CHANNELS = ["whatsapp", "webchat", "messenger", "instagram"];

// ======================================================
// Helpers
// ======================================================

function now() {
  return new Date();
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

// ======================================================
// STATE (anti-CSRF para Embedded Signup)
// ======================================================

function signState(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");
  return Buffer.from(`${raw}.${sig}`).toString("base64");
}

function verifyState(state) {
  const decoded = Buffer.from(state, "base64").toString("utf8");
  const [raw, sig] = decoded.split(".");
  const expected = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  if (!raw || !sig) throw new Error("invalid_state");
  if (sig !== expected) throw new Error("invalid_state");
  return JSON.parse(raw);
}

// ======================================================
// Shape (normaliza saída pro frontend)
// ======================================================

function shapeChannel(c) {
  if (!c) return null;

  return {
    enabled: c.enabled,
    status: c.status,
    widgetKey: c.widgetKey || null,
    config: c.config || {},
    updatedAt: c.updatedAt
  };
}

function shapeChannels(list) {
  const out = {};
  for (const c of list) {
    out[c.channel] = shapeChannel(c);
  }
  return out;
}

// ======================================================
// GET /settings/channels
// ======================================================

router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: "tenant_not_resolved" });
      }

      // garante que todos os canais existem
      for (const ch of CHANNELS) {
        await prisma.channelConfig.upsert({
          where: { tenantId_channel: { tenantId, channel: ch } },
          update: {},
          create: {
            tenantId,
            channel: ch,
            enabled: false,
            status: ch === "webchat" ? "disabled" : "disconnected",
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
        where: { tenantId }
      });

      res.json({ channels: shapeChannels(channels) });
    } catch (e) {
      logger.error({ err: e }, "❌ GET /settings/channels");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// POST /settings/channels/whatsapp/start
// ======================================================

router.post(
  "/whatsapp/start",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: "tenant_not_resolved" });
      }

      const appId = requireEnv("META_APP_ID");

      const state = signState({
        tenantId,
        ts: Date.now()
      });

      res.json({
        appId,
        state,
        scopes: ["whatsapp_business_messaging", "business_management"]
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/whatsapp/start");
      res.status(500).json({ error: e?.message || "internal_error" });
    }
  }
);

// ======================================================
// POST /settings/channels/whatsapp/callback
// ======================================================

router.post(
  "/whatsapp/callback",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { code, state } = req.body || {};
      if (!code || !state) {
        return res.status(400).json({ error: "missing_code_or_state" });
      }

      // valida state e extrai tenant
      const parsed = verifyState(String(state));
      const tenantIdFromState = String(parsed?.tenantId || "").trim();
      if (!tenantIdFromState) {
        return res.status(400).json({ error: "invalid_state" });
      }

      // segurança extra: state precisa bater com o tenant resolvido/autorizado
      const tenantIdReq = getTenantId(req);
      if (!tenantIdReq) {
        return res.status(400).json({ error: "tenant_not_resolved" });
      }
      if (String(tenantIdReq) !== tenantIdFromState) {
        return res.status(403).json({ error: "state_tenant_mismatch" });
      }

      // exige envs essenciais
      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");
      const redirectUri = requireEnv("META_EMBEDDED_REDIRECT_URI");

      // Meta exige x-www-form-urlencoded (NÃO JSON)
      const params = new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code: String(code)
      });

      const tokenRes = await fetch(
        "https://graph.facebook.com/v19.0/oauth/access_token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString()
        }
      ).then((r) => r.json());

      if (!tokenRes?.access_token) {
        logger.error({ tokenRes }, "❌ Meta token exchange failed");
        return res.status(400).json({ error: "token_exchange_failed" });
      }

      // garante que o registro existe (se alguém chamar callback antes do GET /channels)
      await prisma.channelConfig.upsert({
        where: {
          tenantId_channel: { tenantId: tenantIdFromState, channel: "whatsapp" }
        },
        update: {},
        create: {
          tenantId: tenantIdFromState,
          channel: "whatsapp",
          enabled: false,
          status: "disconnected",
          widgetKey: null,
          config: {}
        }
      });

      await prisma.channelConfig.update({
        where: {
          tenantId_channel: {
            tenantId: tenantIdFromState,
            channel: "whatsapp"
          }
        },
        data: {
          enabled: true,
          status: "connected",
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type,
            expiresIn: tokenRes.expires_in,
            connectedAt: new Date().toISOString()
          },
          updatedAt: now()
        }
      });

      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/whatsapp/callback");
      res.status(500).json({ error: "whatsapp_connect_failed" });
    }
  }
);

// ======================================================
// DELETE /settings/channels/whatsapp
// ======================================================

router.delete(
  "/whatsapp",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: "tenant_not_resolved" });
      }

      await prisma.channelConfig.update({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        data: {
          enabled: false,
          status: "disconnected",
          config: {},
          updatedAt: now()
        }
      });

      res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "❌ DELETE /settings/channels/whatsapp");
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
