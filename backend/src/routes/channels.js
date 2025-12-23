// backend/src/routes/settingsChannelsRouter.js
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
// STATE (anti-CSRF para Embedded Signup) — FIX DEFINITIVO
// ======================================================

function signState(payload) {
  const raw = JSON.stringify(payload);

  const sig = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  // raw pode conter "." (ex: redirectUri com domínio). Então o separador real
  // precisa ser recuperado pelo ÚLTIMO ponto no decode.
  return Buffer.from(`${raw}.${sig}`, "utf8").toString("base64");
}

function verifyState(state) {
  let decoded = "";
  try {
    decoded = Buffer.from(String(state || ""), "base64").toString("utf8");
  } catch {
    throw new Error("invalid_state");
  }

  // ✅ pega o separador pelo ÚLTIMO "."
  const idx = decoded.lastIndexOf(".");
  if (idx <= 0) throw new Error("invalid_state");

  const raw = decoded.slice(0, idx);
  const sig = decoded.slice(idx + 1);

  if (!raw || !sig) throw new Error("invalid_state");

  const expected = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  if (sig !== expected) throw new Error("invalid_state");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid_state");
  }
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
// ✅ FIX DEFINITIVO: backend é fonte única do redirect_uri
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
      const redirectUri = requireEnv("META_EMBEDDED_REDIRECT_URI");

      const state = signState({
        tenantId,
        redirectUri, // 🔐 garante igualdade do fluxo inteiro
        ts: Date.now()
      });

      logger.info(
        { tenantId, redirectUri },
        "🟢 WhatsApp Embedded Signup start"
      );

      res.json({
        appId,
        redirectUri,
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
// ✅ FIX DEFINITIVO: valida redirect_uri do state vs env
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

      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");
      const redirectUriEnv = requireEnv("META_EMBEDDED_REDIRECT_URI");

      const parsedState = verifyState(state);
      const tenantId = String(parsedState?.tenantId || "").trim();
      const redirectUriFromState = String(parsedState?.redirectUri || "").trim();

      if (!tenantId) return res.status(400).json({ error: "invalid_state" });

      // 🔒 blindagem anti-mismatch / anti-fallback
      if (redirectUriFromState !== redirectUriEnv) {
        logger.error(
          {
            tenantId,
            redirectUriFromState,
            redirectUriEnv
          },
          "❌ redirect_uri mismatch detected"
        );
        return res.status(400).json({ error: "redirect_uri_mismatch" });
      }

      const redirectUri = redirectUriEnv;

      // ✅ Meta aceita GET com querystring (bem compatível)
      const url =
        "https://graph.facebook.com/v19.0/oauth/access_token" +
        `?client_id=${encodeURIComponent(appId)}` +
        `&client_secret=${encodeURIComponent(appSecret)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&code=${encodeURIComponent(code)}`;

      const tokenRes = await fetch(url, { method: "GET" }).then((r) => r.json());

      if (!tokenRes?.access_token) {
        logger.error(
          {
            tokenRes,
            redirectUriUsed: redirectUri,
            tenantId
          },
          "❌ Meta token exchange failed"
        );

        return res.status(400).json({
          error: "token_exchange_failed",
          meta: tokenRes?.error || tokenRes
        });
      }

      await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        update: {
          enabled: true,
          status: "connected",
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type || null,
            expiresIn: tokenRes.expires_in || null,
            connectedAt: new Date().toISOString()
          },
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "whatsapp",
          enabled: true,
          status: "connected",
          widgetKey: null,
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type || null,
            expiresIn: tokenRes.expires_in || null,
            connectedAt: new Date().toISOString()
          }
        }
      });

      return res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "❌ whatsapp callback error");
      return res.status(500).json({ error: "whatsapp_connect_failed" });
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
