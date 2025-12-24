// backend/src/routes/channels.js
import express from "express";
import crypto from "crypto";
import prismaMod from "../lib/prisma.js";
import {
  requireAuth,
  enforceTokenTenant,
  requireRole
} from "../middleware/requireAuth.js";
import logger from "../logger.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

const CHANNELS = ["whatsapp", "webchat", "messenger", "instagram"];

// ======================================================
// Helpers
// ======================================================

function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function safeOriginFromReferer(referer) {
  try {
    const u = new URL(String(referer || ""));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function safePathFromReferer(referer) {
  try {
    const u = new URL(String(referer || ""));
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch {
    return "";
  }
}

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

// ======================================================
// STATE (anti-CSRF) — base64url
// Fonte da verdade para redirectUri: SEM normalizar.
// ======================================================

function b64urlEncode(str) {
  return Buffer.from(String(str), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function b64urlDecodeToUtf8(b64url) {
  const s = String(b64url || "")
    .trim()
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function signState(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  // formato: base64url(raw.sig)
  return b64urlEncode(`${raw}.${sig}`);
}

function verifyState(state) {
  const decoded = b64urlDecodeToUtf8(state);
  const lastDot = decoded.lastIndexOf(".");
  if (lastDot <= 0) throw new Error("invalid_state");

  const raw = decoded.slice(0, lastDot);
  const sig = decoded.slice(lastDot + 1);

  const expected = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  if (!sig || sig !== expected) throw new Error("invalid_state");

  const payload = JSON.parse(raw);

  // expira em 10 min
  const ts = Number(payload?.ts || 0);
  if (ts && Date.now() - ts > 10 * 60 * 1000) throw new Error("invalid_state");

  // valida campos mínimos
  if (!payload?.tenantId) throw new Error("invalid_state");
  if (!payload?.redirectUri) throw new Error("invalid_state");

  return payload;
}

// ======================================================
// Normalização de saída
// (SEM allowedOrigins no model — fica tudo dentro de config)
// ======================================================

function shapeChannel(c) {
  if (!c) return null;
  return {
    enabled: !!c.enabled,
    status: c.status,
    widgetKey: c.widgetKey || null,
    config: c.config || {},
    updatedAt: c.updatedAt
  };
}

function shapeChannels(list) {
  const out = {};
  for (const c of list) out[c.channel] = shapeChannel(c);
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
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      // garante que todos os canais existem (SEM allowedOrigins no model)
      for (const ch of CHANNELS) {
        const isWebchat = ch === "webchat";

        await prisma.channelConfig.upsert({
          where: { tenantId_channel: { tenantId, channel: ch } },
          update: {},
          create: {
            tenantId,
            channel: ch,
            enabled: false,
            status: isWebchat ? "disabled" : "disconnected",
            widgetKey: isWebchat ? newWidgetKey() : null,
            config: isWebchat
              ? {
                  primaryColor: "#34d399",
                  position: "right",
                  buttonText: "Ajuda",
                  headerTitle: "Atendimento",
                  greeting: "Olá! Como posso ajudar?",
                  // allowedOrigins dentro do JSON
                  allowedOrigins: [],
                  sessionTtlSeconds: 0
                }
              : {}
          }
        });
      }

      const channels = await prisma.channelConfig.findMany({ where: { tenantId } });

      // ✅ compat: seu front trata { channels } e também array
      return res.json({ channels: shapeChannels(channels) });
    } catch (e) {
      logger.error({ err: e }, "❌ GET /settings/channels");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// PATCH /settings/channels/webchat
// (SEM allowedOrigins no model — salva dentro do config)
// ======================================================

router.patch(
  "/webchat",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const enabled = req.body?.enabled;
      const cfg = req.body?.config || {};
      const sessionTtlSeconds = req.body?.sessionTtlSeconds;

      // allowedOrigins vem do front, mas vai dentro do JSON config
      const allowedOrigins = Array.isArray(req.body?.allowedOrigins)
        ? req.body.allowedOrigins
        : undefined;

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "webchat" } }
      });

      const mergedConfig = {
        ...(current?.config || {}),
        ...(cfg || {})
      };

      if (allowedOrigins) mergedConfig.allowedOrigins = allowedOrigins;
      if (typeof sessionTtlSeconds === "number") mergedConfig.sessionTtlSeconds = sessionTtlSeconds;

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "webchat" } },
        update: {
          enabled: typeof enabled === "boolean" ? enabled : undefined,
          status:
            typeof enabled === "boolean"
              ? enabled
                ? "connected"
                : "disabled"
              : undefined,
          config: mergedConfig,
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "webchat",
          enabled: typeof enabled === "boolean" ? enabled : false,
          status: typeof enabled === "boolean" && enabled ? "connected" : "disabled",
          widgetKey: newWidgetKey(),
          config: mergedConfig
        }
      });

      return res.json(shapeChannel(updated));
    } catch (e) {
      logger.error({ err: e }, "❌ PATCH /settings/channels/webchat");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// POST /settings/channels/webchat/rotate-key
// ======================================================

router.post(
  "/webchat/rotate-key",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const widgetKey = newWidgetKey();

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "webchat" } },
        update: { widgetKey, updatedAt: new Date() },
        create: {
          tenantId,
          channel: "webchat",
          enabled: false,
          status: "disabled",
          widgetKey,
          config: {
            primaryColor: "#34d399",
            position: "right",
            buttonText: "Ajuda",
            headerTitle: "Atendimento",
            greeting: "Olá! Como posso ajudar?",
            allowedOrigins: [],
            sessionTtlSeconds: 0
          }
        }
      });

      return res.json({ widgetKey: updated.widgetKey });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/webchat/rotate-key");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// GET /settings/channels/webchat/snippet
// ======================================================

router.get(
  "/webchat/snippet",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const row = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "webchat" } }
      });

      if (!row?.widgetKey) return res.status(404).json({ error: "webchat_not_configured" });

      const cfg = row.config || {};
      const allowedOrigins = Array.isArray(cfg.allowedOrigins) ? cfg.allowedOrigins : [];

      const color = String(cfg.primaryColor || cfg.color || "#34d399");
      const position = cfg.position === "left" ? "left" : "right";
      const buttonText = String(cfg.buttonText || "Ajuda");
      const title = String(cfg.headerTitle || cfg.title || "Atendimento");
      const greeting = String(cfg.greeting || "Olá! Como posso ajudar?");
      const apiBase = String(process.env.PUBLIC_API_BASE || "https://api.gplabs.com.br");

      const scriptTag = `<script
  src="https://widget.gplabs.com.br/widget.js"
  data-widget-key="${row.widgetKey}"
  data-api-base="${apiBase}"
  data-color="${color}"
  data-position="${position}"
  data-button-text="${buttonText.replace(/"/g, "&quot;")}"
  data-title="${title.replace(/"/g, "&quot;")}"
  data-greeting="${greeting.replace(/"/g, "&quot;")}"
  async
></script>`;

      return res.json({
        ok: true,
        enabled: !!row.enabled,
        status: row.status,
        widgetKey: row.widgetKey,
        allowedOrigins,
        scriptTag,
        widgetJsUrl: "https://widget.gplabs.com.br/widget.js",
        sessionTtlSeconds: Number(cfg.sessionTtlSeconds || 0)
      });
    } catch (e) {
      logger.error({ err: e }, "❌ GET /settings/channels/webchat/snippet");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// WHATSAPP Embedded Signup
// Regra de ouro: redirectUri NÃO é normalizado.
// Ele precisa ser IDENTICO ao que:
// - você cadastrou na Meta (Valid OAuth Redirect URIs)
// - você enviou no FB.login (redirect_uri)
// - você usa no token exchange
// ======================================================

router.post(
  "/whatsapp/start",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const appId = requireEnv("META_APP_ID");

      // ✅ NÃO coloque barra / NÃO remova barra.
      // Use EXACTAMENTE o valor do env (apenas trim).
      const redirectUri = String(process.env.META_EMBEDDED_REDIRECT_URI || "").trim();
      if (!redirectUri) throw new Error("META_EMBEDDED_REDIRECT_URI não configurado");

      // state carrega tenantId + redirectUri exato (fonte da verdade)
      const state = signState({
        tenantId,
        redirectUri,
        ts: Date.now()
      });

      logger.info({ tenantId, redirectUri }, "🟢 WhatsApp Embedded Signup start");

      return res.json({
        appId,
        state,
        redirectUri,
        scopes: ["whatsapp_business_messaging", "business_management"]
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/whatsapp/start");
      return res.status(500).json({ error: e?.message || "internal_error" });
    }
  }
);

async function exchangeCodeForToken({ appId, appSecret, code, redirectUri }) {
  const url =
    "https://graph.facebook.com/v19.0/oauth/access_token" +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  // Node 20 tem fetch nativo
  const r = await fetch(url, { method: "GET" });
  return r.json();
}

router.post(
  "/whatsapp/callback",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const { code, state } = req.body || {};
      if (!code || !state) return res.status(400).json({ error: "missing_code_or_state" });

      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");

      // ✅ fonte da verdade
      const parsedState = verifyState(state);
      const tenantId = String(parsedState?.tenantId || "").trim();
      const redirectUri = String(parsedState?.redirectUri || "").trim();

      if (!tenantId || !redirectUri) return res.status(400).json({ error: "invalid_state" });

      // (debug) se quiser comparar com referer
      const ref = String(req.headers.referer || "");
      const refOrigin = safeOriginFromReferer(ref);
      const refPath = safePathFromReferer(ref);

      logger.info(
        { tenantId, redirectUri, refOrigin, refPath },
        "🟡 WhatsApp callback: exchanging code"
      );

      // ✅ 1 tentativa só (evita loteria / erro 191)
      const tokenRes = await exchangeCodeForToken({
        appId,
        appSecret,
        code,
        redirectUri
      });

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

      // ✅ salva no config JSON (sem allowedOrigins no model)
      await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        update: {
          enabled: true,
          status: "connected",
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type || null,
            expiresIn: tokenRes.expires_in || null,
            redirectUriUsed: redirectUri,
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
            redirectUriUsed: redirectUri,
            connectedAt: new Date().toISOString()
          }
        }
      });

      return res.json({ ok: true, redirectUriUsed: redirectUri });
    } catch (e) {
      logger.error({ err: e }, "❌ whatsapp callback error");
      return res.status(500).json({ error: "whatsapp_connect_failed" });
    }
  }
);

router.delete(
  "/whatsapp",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      await prisma.channelConfig.update({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        data: {
          enabled: false,
          status: "disconnected",
          config: {},
          updatedAt: new Date()
        }
      });

      return res.json({ ok: true });
    } catch (e) {
      logger.error({ err: e }, "❌ DELETE /settings/channels/whatsapp");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
