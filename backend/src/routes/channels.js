// backend/src/routes/channels.js
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
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

function stripTrailingSlash(url) {
  return String(url || "").replace(/\/+$/, "");
}

function ensureTrailingSlash(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s : `${s}/`;
}

function safeOriginFromReferer(referer) {
  try {
    const u = new URL(String(referer || ""));
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function safeFullFromReferer(referer) {
  try {
    return String(new URL(String(referer || "")).toString());
  } catch {
    return "";
  }
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

function decodeBase64Compat(state) {
  // tolera base64url (-/_)
  const s = String(state || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(s, "base64").toString("utf8");
}

function verifyState(state) {
  const decoded = decodeBase64Compat(state);
  const [raw, sig] = decoded.split(".");
  const expected = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  if (!raw || !sig) throw new Error("invalid_state");
  if (sig !== expected) throw new Error("invalid_state");

  const payload = JSON.parse(raw);

  // opcional: expira state (10 min)
  const ts = Number(payload?.ts || 0);
  if (ts && Date.now() - ts > 10 * 60 * 1000) throw new Error("invalid_state");

  return payload;
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
    allowedOrigins: c.allowedOrigins || [],
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
            allowedOrigins: ch === "webchat" ? [] : [],
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

      const channels = await prisma.channelConfig.findMany({ where: { tenantId } });
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
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const appId = requireEnv("META_APP_ID");

      // ✅ Fonte da verdade (env) + normalização
      const envRedirect = String(process.env.META_EMBEDDED_REDIRECT_URI || "").trim();
      const redirectUri = ensureTrailingSlash(envRedirect);

      const state = signState({ tenantId, ts: Date.now() });

      logger.info({ tenantId, redirectUri }, "🟢 WhatsApp Embedded Signup start");

      res.json({
        appId,
        state,
        redirectUri,
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

async function exchangeCodeForToken({ appId, appSecret, code, redirectUri }) {
  const url =
    "https://graph.facebook.com/v19.0/oauth/access_token" +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  return fetch(url, { method: "GET" }).then((r) => r.json());
}

function buildRedirectCandidates(req) {
  const candidates = [];

  const envRaw = String(process.env.META_EMBEDDED_REDIRECT_URI || "").trim();
  const envNoSlash = stripTrailingSlash(envRaw);
  const envWithSlash = ensureTrailingSlash(envRaw);

  if (envWithSlash) candidates.push(envWithSlash);
  if (envNoSlash) candidates.push(envNoSlash);

  // referer ajuda MUITO (às vezes o OAuth usa o URL atual)
  const ref = String(req.headers.referer || "");
  const refOrigin = safeOriginFromReferer(ref);
  const refFull = safeFullFromReferer(ref);

  if (refOrigin) {
    candidates.push(ensureTrailingSlash(refOrigin));
    candidates.push(stripTrailingSlash(refOrigin));
  }

  // se o SPA estiver em /settings/channels
  if (refOrigin) {
    candidates.push(`${stripTrailingSlash(refOrigin)}/settings/channels`);
    candidates.push(`${stripTrailingSlash(refOrigin)}/settings/channels/`);
  }

  if (refFull) {
    // remove query/hash e tenta como está
    try {
      const u = new URL(refFull);
      u.hash = "";
      u.search = "";
      candidates.push(u.toString());
      candidates.push(stripTrailingSlash(u.toString()));
      candidates.push(ensureTrailingSlash(u.toString()));
    } catch {}
  }

  // dedupe
  return Array.from(new Set(candidates.filter(Boolean)));
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

      const parsedState = verifyState(state);
      const tenantId = String(parsedState?.tenantId || "").trim();
      if (!tenantId) return res.status(400).json({ error: "invalid_state" });

      const candidates = buildRedirectCandidates(req);

      let tokenRes = null;
      let usedRedirectUri = null;

      for (const candidate of candidates) {
        const r = await exchangeCodeForToken({
          appId,
          appSecret,
          code,
          redirectUri: candidate
        });

        // sucesso
        if (r?.access_token) {
          tokenRes = r;
          usedRedirectUri = candidate;
          break;
        }

        // se não for o erro 36008, não adianta tentar os outros
        const sub = r?.error?.error_subcode;
        if (sub && Number(sub) !== 36008) {
          tokenRes = r;
          usedRedirectUri = candidate;
          break;
        }

        // segue tentando se for 36008
        tokenRes = r;
        usedRedirectUri = candidate;
      }

      if (!tokenRes?.access_token) {
        logger.error(
          {
            tokenRes,
            triedRedirectUris: candidates,
            redirectUriUsed: usedRedirectUri,
            tenantId
          },
          "❌ Meta token exchange failed"
        );

        return res.status(400).json({
          error: "token_exchange_failed",
          meta: tokenRes?.error || tokenRes
        });
      }

      logger.info(
        { tenantId, redirectUriUsed: usedRedirectUri },
        "✅ Meta token exchange OK"
      );

      await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        update: {
          enabled: true,
          status: "connected",
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type || null,
            expiresIn: tokenRes.expires_in || null,
            redirectUriUsed: usedRedirectUri,
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
          allowedOrigins: [],
          config: {
            accessToken: tokenRes.access_token,
            tokenType: tokenRes.token_type || null,
            expiresIn: tokenRes.expires_in || null,
            redirectUriUsed: usedRedirectUri,
            connectedAt: new Date().toISOString()
          }
        }
      });

      return res.json({ ok: true, redirectUriUsed: usedRedirectUri });
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
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

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
