// backend/src/routes/channels.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import logger from "../logger.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

const CHANNELS = ["whatsapp", "webchat", "messenger", "instagram"];
const META_GRAPH_VERSION = String(process.env.META_GRAPH_VERSION || "v21.0").trim();

// ======================================================
// Helpers (MISSING FIXES + SAFETY)
// ======================================================
function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

function optionalEnv(name) {
  return String(process.env[name] || "").trim() || "";
}

function nowIso() {
  return new Date().toISOString();
}

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || req.user?.tenantId || null;
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

// ======================================================
// Resolve base URL do Front (fallback de redirectUri)
// ======================================================
function normalizeRedirectUri(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function getFrontendBaseFromReq(req) {
  const fromEnv =
    normalizeRedirectUri(process.env.PUBLIC_APP_BASE) ||
    normalizeRedirectUri(process.env.FRONTEND_BASE_URL) ||
    normalizeRedirectUri(process.env.WEB_APP_BASE) ||
    normalizeRedirectUri(process.env.APP_BASE_URL) ||
    "";

  if (fromEnv) return fromEnv;

  const origin = String(req?.headers?.origin || "").trim();
  if (origin) return normalizeRedirectUri(origin);

  const referer = String(req?.headers?.referer || "").trim();
  if (referer) {
    try {
      const u = new URL(referer);
      return normalizeRedirectUri(u.origin);
    } catch {
      // ignore
    }
  }

  const proto =
    String(req?.headers?.["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() || "https";

  const host = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "")
    .split(",")[0]
    .trim();

  if (host) return normalizeRedirectUri(`${proto}://${host}`);

  return "";
}

function getOAuthRedirectUri(req, channel) {
  // single source of truth:
  // - META_OAUTH_REDIRECT_URI (whatsapp)
  // - META_INSTAGRAM_OAUTH_REDIRECT_URI (instagram)
  // fallback: <frontendBase>/settings/channels/<channel>/callback
  const envKey =
    channel === "instagram" ? "META_INSTAGRAM_OAUTH_REDIRECT_URI" : "META_OAUTH_REDIRECT_URI";

  const envUri = normalizeRedirectUri(process.env[envKey]);
  if (envUri) return envUri;

  const base = getFrontendBaseFromReq(req);
  if (!base) throw new Error(`${envKey} não configurado e não foi possível inferir base do front`);

  return `${base}/settings/channels/${channel}/callback`;
}

// ======================================================
// STATE (anti-CSRF)
// ======================================================
function base64urlEncode(str) {
  return Buffer.from(String(str), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64urlDecode(b64url) {
  const s = String(b64url || "").trim().replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s + pad, "base64").toString("utf8");
}

function signState(payload) {
  const raw = JSON.stringify(payload);
  const sig = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  // ⚠️ separador "." — verify corta PELO ÚLTIMO ponto
  return base64urlEncode(`${raw}.${sig}`);
}

function verifyState(state) {
  const s = String(state || "").trim();
  const decoded = base64urlDecode(s);

  const idx = String(decoded || "").lastIndexOf(".");
  if (idx <= 0) throw new Error("invalid_state");

  const raw = String(decoded).slice(0, idx);
  const sig = String(decoded).slice(idx + 1);

  const expected = crypto
    .createHmac("sha256", requireEnv("JWT_SECRET"))
    .update(raw)
    .digest("hex");

  if (!raw || !sig) throw new Error("invalid_state");
  if (sig !== expected) throw new Error("invalid_state");

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error("invalid_state");
  }

  const ts = Number(payload?.ts || 0);
  if (ts && Date.now() - ts > 10 * 60 * 1000) throw new Error("invalid_state");

  return payload;
}

// ======================================================
// Normalização de saída (não vazar tokens)
// ======================================================
function shapeChannel(c) {
  if (!c) return null;
  const cfg = c.config && typeof c.config === "object" ? c.config : {};
  return {
    enabled: !!c.enabled,
    status: c.status,
    widgetKey: c.widgetKey || null,

    // colunas first-class (não vazar token)
    pageId: c.pageId || null,
    phoneNumberId: c.phoneNumberId || null,
    wabaId: c.wabaId || null,
    displayName: c.displayName || null,
    displayPhoneNumber: c.displayPhoneNumber || null,
    hasAccessToken: !!c.accessToken,

    config: cfg,
    updatedAt: c.updatedAt
  };
}

function shapeChannels(list) {
  const out = {};
  for (const c of list) out[c.channel] = shapeChannel(c);
  return out;
}

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

// ======================================================
// Graph helpers
// ======================================================
async function graphGetJson(url, accessToken) {
  const resp = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const raw = await resp.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  return { ok: resp.ok, status: resp.status, data, raw };
}

async function graphPostJson(url, accessToken, bodyObj = {}) {
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(bodyObj)
  });

  const raw = await resp.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }

  return { ok: resp.ok, status: resp.status, data, raw };
}

// ======================================================
// META OAuth helpers (User short -> long-lived)
// ======================================================
async function exchangeForLongLivedUserToken(anyUserToken) {
  const appId = requireEnv("META_APP_ID");
  const appSecret = requireEnv("META_APP_SECRET");

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token` +
    `?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(anyUserToken)}`;

  const r = await fetch(url, { method: "GET" });
  const raw = await r.text().catch(() => "");
  let j = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = { raw };
  }

  if (!r.ok || !j?.access_token) {
    return { ok: false, error: "long_lived_exchange_failed", meta: j?.error || j, status: r.status };
  }

  return {
    ok: true,
    accessToken: String(j.access_token),
    expiresIn: j.expires_in ?? null,
    tokenType: j.token_type ?? null
  };
}

async function fetchPageAccessTokenFromUser(userToken, pageId) {
  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts` +
    `?fields=id,name,access_token` +
    `&access_token=${encodeURIComponent(userToken)}`;

  const r = await fetch(url, { method: "GET" });
  const j = await r.json().catch(() => ({}));

  if (!r.ok) {
    logger.warn({ status: r.status, meta: j?.error || j }, "❌ Meta /me/accounts failed");
    return { ok: false, error: "me_accounts_failed", meta: j?.error || j };
  }

  const data = Array.isArray(j?.data) ? j.data : [];
  const row = data.find((p) => String(p?.id || "") === String(pageId));

  if (!row?.access_token) {
    return { ok: false, error: "page_token_not_found", meta: { pagesCount: data.length } };
  }

  return {
    ok: true,
    pageAccessToken: String(row.access_token),
    pageName: String(row?.name || "").trim()
  };
}

// ======================================================
// Instagram OAuth (Zenvia-like)
// ======================================================
function buildMetaOAuthUrl({ redirectUri, state, scopes }) {
  const appId = requireEnv("META_APP_ID");
  const scope = Array.isArray(scopes) ? scopes.join(",") : String(scopes || "");

  return (
    `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}`
  );
}

async function exchangeCodeForUserToken({ code, redirectUri }) {
  const appId = requireEnv("META_APP_ID");
  const appSecret = requireEnv("META_APP_SECRET");

  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  const r = await fetch(url, { method: "GET" });
  const raw = await r.text().catch(() => "");
  let j = {};
  try {
    j = raw ? JSON.parse(raw) : {};
  } catch {
    j = { raw };
  }

  return { ok: r.ok, status: r.status, json: j };
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
                  allowedOrigins: []
                }
              : {}
          }
        });
      }

      const channels = await prisma.channelConfig.findMany({ where: { tenantId } });
      return res.json({ channels: shapeChannels(channels) });
    } catch (e) {
      logger.error({ err: e }, "❌ GET /settings/channels");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// PATCH /settings/channels/webchat
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

      const allowedOrigins = Array.isArray(req.body?.allowedOrigins) ? req.body.allowedOrigins : undefined;

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "webchat" } }
      });

      const mergedConfig = { ...(current?.config || {}), ...(cfg || {}) };
      if (allowedOrigins) mergedConfig.allowedOrigins = allowedOrigins;
      if (typeof sessionTtlSeconds === "number") mergedConfig.sessionTtlSeconds = sessionTtlSeconds;

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "webchat" } },
        update: {
          enabled: typeof enabled === "boolean" ? enabled : undefined,
          status: typeof enabled === "boolean" ? (enabled ? "connected" : "disabled") : undefined,
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
            allowedOrigins: []
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
        sessionTtlSeconds: cfg.sessionTtlSeconds || 0
      });
    } catch (e) {
      logger.error({ err: e }, "❌ GET /settings/channels/webchat/snippet");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// ✅ MESSENGER
// ======================================================

// POST /settings/channels/messenger/pages
router.post(
  "/messenger/pages",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const userAccessToken = String(req.body?.userAccessToken || "").trim();
      if (!userAccessToken) return res.status(400).json({ error: "userAccessToken_required" });

      const url =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts` +
        `?fields=id,name,access_token` +
        `&access_token=${encodeURIComponent(userAccessToken)}`;

      const r = await fetch(url, { method: "GET" });
      const j = await r.json().catch(() => ({}));

      if (!r.ok) {
        logger.warn({ status: r.status, meta: j?.error || j }, "❌ Messenger pages list failed");
        return res.status(400).json({ error: "meta_list_pages_failed", meta: j?.error || j });
      }

      const data = Array.isArray(j.data) ? j.data : [];
      return res.json({
        pages: data.map((p) => ({
          id: String(p?.id || ""),
          name: String(p?.name || ""),
          pageAccessToken: String(p?.access_token || "")
        }))
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/messenger/pages");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// POST /settings/channels/messenger/connect
router.post(
  "/messenger/connect",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const pageId = String(req.body?.pageId || "").trim();
      const pageAccessToken = String(req.body?.pageAccessToken || "").trim();

      const subscribedFields = Array.isArray(req.body?.subscribedFields)
        ? req.body.subscribedFields.map(String).map((s) => s.trim()).filter(Boolean)
        : ["messages", "messaging_postbacks"];

      if (!pageId) return res.status(400).json({ error: "pageId_required" });
      if (!pageAccessToken) return res.status(400).json({ error: "pageAccessToken_required" });

      const validateUrl =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}` +
        `?fields=id,name` +
        `&access_token=${encodeURIComponent(pageAccessToken)}`;

      const v = await fetch(validateUrl, { method: "GET" });
      const vj = await v.json().catch(() => ({}));

      if (!v.ok || !vj?.id) {
        logger.warn({ status: v.status, meta: vj?.error || vj, tenantId, pageId }, "❌ Messenger connect validate failed");
        return res.status(400).json({ error: "meta_page_token_invalid", meta: vj?.error || vj });
      }

      const displayName = String(vj?.name || "Facebook Page").trim();

      const subUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`;
      const subRes = await graphPostJson(subUrl, pageAccessToken, { subscribed_fields: subscribedFields });

      if (!subRes.ok) {
        logger.warn({ status: subRes.status, meta: subRes.data?.error || subRes.data, tenantId, pageId }, "❌ Messenger subscribe failed");
        return res.status(400).json({ error: "meta_subscribe_failed", meta: subRes.data?.error || subRes.data });
      }

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "messenger" } }
      });

      const mergedConfig = {
        ...(current?.config || {}),
        subscribedFields,
        connectedAt: nowIso(),
        graphVersion: META_GRAPH_VERSION
      };

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "messenger" } },
        update: {
          enabled: true,
          status: "connected",
          pageId,
          accessToken: pageAccessToken,
          displayName,
          config: mergedConfig,
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "messenger",
          enabled: true,
          status: "connected",
          widgetKey: null,
          pageId,
          accessToken: pageAccessToken,
          displayName,
          config: mergedConfig
        }
      });

      return res.json({ ok: true, messenger: shapeChannel(updated) });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/messenger/connect");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// DELETE /settings/channels/messenger
router.delete(
  "/messenger",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "messenger" } }
      });

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "messenger" } },
        update: {
          enabled: false,
          status: "disconnected",
          pageId: null,
          accessToken: null,
          displayName: null,
          config: { ...(current?.config || {}), disconnectedAt: nowIso() },
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "messenger",
          enabled: false,
          status: "disconnected",
          widgetKey: null,
          pageId: null,
          accessToken: null,
          displayName: null,
          config: { disconnectedAt: nowIso() }
        }
      });

      return res.json({ ok: true, messenger: shapeChannel(updated) });
    } catch (e) {
      logger.error({ err: e }, "❌ DELETE /settings/channels/messenger");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// ✅ INSTAGRAM — OAuth Zenvia-like (ALINHADO COM FRONT: callback -> pages + connectState)
// ======================================================

// POST /settings/channels/instagram/start
router.post(
  "/instagram/start",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const redirectUri = getOAuthRedirectUri(req, "instagram");

      const scopes = [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_metadata",
        "pages_messaging",
        "instagram_basic",
        "instagram_manage_messages"
      ];

      const state = signState({
        tenantId,
        ts: Date.now(),
        channel: "instagram",
        redirectUri
      });

      const authUrl = buildMetaOAuthUrl({ redirectUri, state, scopes });

      return res.json({
        ok: true,
        authUrl,
        redirectUri,
        state,
        scopes,
        graphVersion: META_GRAPH_VERSION
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/instagram/start");
      const msg = String(e?.message || "internal_error");
      const isConfig = /não configurado|inferir base/i.test(msg);
      return res.status(isConfig ? 400 : 500).json({ error: msg });
    }
  }
);

// POST /settings/channels/instagram/callback
router.post(
  "/instagram/callback",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    const reqId = req.id || req.headers["x-request-id"] || null;

    try {
      const code = String(req.body?.code || "").trim();
      const state = String(req.body?.state || "").trim();
      if (!code || !state) return res.status(400).json({ error: "missing_code_or_state" });

      // 0) verify state
      let parsed;
      try {
        parsed = verifyState(state);
      } catch (e) {
        logger.warn({ reqId, err: e?.message || String(e), stateLen: state.length, tenantReq: getTenantId(req) || null }, "❌ Instagram callback invalid_state");
        return res.status(400).json({ error: "invalid_state" });
      }

      const tenantIdFromState = String(parsed?.tenantId || "").trim();
      const channel = String(parsed?.channel || "").trim();
      const redirectUriFromState = String(parsed?.redirectUri || "").trim();

      if (!tenantIdFromState) return res.status(400).json({ error: "invalid_state" });
      if (channel && channel !== "instagram") return res.status(400).json({ error: "invalid_state" });

      const tenantIdReq = getTenantId(req);
      if (tenantIdReq && String(tenantIdReq) !== tenantIdFromState) {
        return res.status(403).json({ error: "tenant_mismatch" });
      }

      // ✅ CRÍTICO: redirect_uri PRECISA ser o MESMO do start (state)
      const redirectUri = redirectUriFromState || getOAuthRedirectUri(req, "instagram");

      // 1) code -> short user token
      const tokenRes = await exchangeCodeForUserToken({ code, redirectUri });
      if (!tokenRes.ok || !tokenRes?.json?.access_token) {
        logger.warn({ reqId, status: tokenRes.status, meta: tokenRes.json?.error || tokenRes.json, redirectUriUsed: redirectUri, tenantId: tenantIdFromState }, "❌ Instagram code->token failed");
        return res.status(400).json({ error: "token_exchange_failed", meta: tokenRes.json?.error || tokenRes.json });
      }

      const shortUserToken = String(tokenRes.json.access_token);

      // 2) short -> long-lived (OBRIGATÓRIO aqui)
      const exchanged = await exchangeForLongLivedUserToken(shortUserToken);
      if (!exchanged.ok || !exchanged.accessToken) {
        logger.warn({ reqId, meta: exchanged.meta || null, tenantId: tenantIdFromState }, "❌ Instagram long-lived exchange failed");
        return res.status(400).json({ error: "long_lived_exchange_failed", meta: exchanged.meta || null });
      }

      const longUserToken = exchanged.accessToken;

      // 3) lista pages (id,name) — front vai escolher
      const meAccountsUrl =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts` +
        `?fields=id,name` +
        `&access_token=${encodeURIComponent(longUserToken)}`;

      const pagesResp = await fetch(meAccountsUrl, { method: "GET" });
      const pagesJson = await pagesResp.json().catch(() => ({}));

      if (!pagesResp.ok) {
        logger.warn({ reqId, status: pagesResp.status, meta: pagesJson?.error || pagesJson, tenantId: tenantIdFromState }, "❌ Instagram /me/accounts failed");
        return res.status(400).json({ error: "meta_list_pages_failed", meta: pagesJson?.error || pagesJson });
      }

      const pages = safeArr(pagesJson?.data)
        .filter((p) => p?.id && p?.name)
        .map((p) => ({ id: String(p.id), name: String(p.name) }));

      if (!pages.length) {
        return res.status(409).json({ error: "no_pages_returned", hint: "A conta não retornou nenhuma Página. Verifique permissões do app e se o usuário administra uma Página." });
      }

      // 4) connectState (assinado) com token long-lived
      const connectState = signState({
        tenantId: tenantIdFromState,
        ts: Date.now(),
        channel: "instagram_connect",
        userAccessToken: longUserToken,
        expiresIn: exchanged.expiresIn ?? null
      });

      return res.json({
        ok: true,
        pages,
        connectState,
        tokenKind: "long_lived",
        expiresIn: exchanged.expiresIn ?? null
      });
    } catch (e) {
      logger.error({ reqId, err: e }, "❌ POST /settings/channels/instagram/callback");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// POST /settings/channels/instagram/connect
router.post(
  "/instagram/connect",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const pageId = String(req.body?.pageId || "").trim();
      const connectState = String(req.body?.connectState || "").trim();
      const subscribedFields = Array.isArray(req.body?.subscribedFields)
        ? req.body.subscribedFields.map(String).map((s) => s.trim()).filter(Boolean)
        : ["messages"];

      if (!pageId) return res.status(400).json({ error: "pageId_required" });
      if (!connectState) return res.status(400).json({ error: "connectState_required" });

      let parsed;
      try {
        parsed = verifyState(connectState);
      } catch {
        return res.status(400).json({ error: "invalid_state" });
      }

      const tid = String(parsed?.tenantId || "").trim();
      const ch = String(parsed?.channel || "").trim();
      const userAccessToken = String(parsed?.userAccessToken || "").trim();
      const userTokenExpiresIn = parsed?.expiresIn ?? null;

      if (!tid || tid !== String(tenantId)) return res.status(403).json({ error: "tenant_mismatch" });
      if (ch && ch !== "instagram_connect") return res.status(400).json({ error: "invalid_state" });
      if (!userAccessToken) return res.status(400).json({ error: "userAccessToken_required" });

      // 1) resolve PAGE TOKEN via /me/accounts?fields=...access_token
      const pageTok = await fetchPageAccessTokenFromUser(userAccessToken, pageId);
      if (!pageTok.ok) {
        return res.status(400).json({ error: pageTok.error, meta: pageTok.meta || null });
      }

      const pageAccessToken = pageTok.pageAccessToken;

      // 2) valida Page token + resolve IG business account
      const pageInfoUrl =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}` +
        `?fields=id,name,instagram_business_account` +
        `&access_token=${encodeURIComponent(pageAccessToken)}`;

      const v = await fetch(pageInfoUrl, { method: "GET" });
      const vj = await v.json().catch(() => ({}));

      if (!v.ok || !vj?.id) {
        logger.warn({ status: v.status, meta: vj?.error || vj, tenantId, pageId }, "❌ Instagram connect validate failed");
        return res.status(400).json({ error: "meta_page_token_invalid", meta: vj?.error || vj });
      }

      const displayName = String(vj?.name || pageTok.pageName || "Facebook Page").trim();
      const instagramBusinessId = vj?.instagram_business_account?.id ? String(vj.instagram_business_account.id) : null;

      if (!instagramBusinessId) {
        return res.status(409).json({
          error: "instagram_not_linked",
          hint: "Essa Página não tem uma conta Instagram Business vinculada (instagram_business_account)."
        });
      }

      // 3) best effort: username
      let igUsername = "";
      try {
        const igInfoUrl =
          `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(instagramBusinessId)}` +
          `?fields=id,username,name&access_token=${encodeURIComponent(pageAccessToken)}`;

        const igResp = await fetch(igInfoUrl, { method: "GET" });
        const igJson = await igResp.json().catch(() => ({}));
        igUsername = igResp.ok && igJson?.id ? String(igJson?.username || "").trim() : "";
      } catch {
        // ignore
      }

      // 4) subscribe (best effort)
      let subscribeOk = false;
      try {
        const subUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}/subscribed_apps`;
        const subRes = await graphPostJson(subUrl, pageAccessToken, { subscribed_fields: subscribedFields });

        subscribeOk = !!subRes.ok;
        if (!subRes.ok) {
          logger.warn({ status: subRes.status, meta: subRes.data?.error || subRes.data, tenantId, pageId }, "⚠️ Instagram subscribe failed (best effort)");
        }
      } catch (e) {
        logger.warn({ err: e, tenantId, pageId }, "⚠️ Instagram subscribe exception (best effort)");
      }

      // 5) salva (instagram) — accessToken = PAGE TOKEN
      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "instagram" } }
      });

      const mergedConfig = {
        ...(current?.config || {}),
        instagramBusinessId,
        igUsername: igUsername || undefined,
        subscribedFields,
        connectedAt: nowIso(),
        graphVersion: META_GRAPH_VERSION,
        tokenKind: "page",
        userTokenExpiresIn
      };

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "instagram" } },
        update: {
          enabled: true,
          status: "connected",
          pageId,
          accessToken: pageAccessToken,
          displayName,
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
          accessToken: pageAccessToken,
          displayName,
          config: mergedConfig
        }
      });

      return res.json({
        ok: true,
        instagram: shapeChannel(updated),
        resolved: {
          pageId,
          pageName: displayName,
          instagramBusinessId,
          igUsername: igUsername || null,
          subscribed: subscribeOk
        }
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/instagram/connect");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// DELETE /settings/channels/instagram
router.delete(
  "/instagram",
  requireAuth,
  enforceTokenTenant,
  requireRole("admin", "manager"),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "instagram" } }
      });

      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "instagram" } },
        update: {
          enabled: false,
          status: "disconnected",
          pageId: null,
          accessToken: null,
          displayName: null,
          config: { ...(current?.config || {}), disconnectedAt: nowIso() },
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "instagram",
          enabled: false,
          status: "disconnected",
          widgetKey: null,
          pageId: null,
          accessToken: null,
          displayName: null,
          config: { disconnectedAt: nowIso() }
        }
      });

      return res.json({ ok: true, instagram: shapeChannel(updated) });
    } catch (e) {
      logger.error({ err: e }, "❌ DELETE /settings/channels/instagram");
      return res.status(500).json({ error: "internal_error" });
    }
  }
);

// ======================================================
// WHATSAPP Embedded Signup
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
      const redirectUri = getOAuthRedirectUri(req, "whatsapp");

      const state = signState({ tenantId, ts: Date.now(), channel: "whatsapp", redirectUri });

      logger.info({ tenantId, redirectUri }, "🟢 WhatsApp Embedded Signup start");

      return res.json({
        appId,
        state,
        redirectUri,
        scopes: ["whatsapp_business_messaging", "business_management"],
        graphVersion: META_GRAPH_VERSION
      });
    } catch (e) {
      logger.error({ err: e }, "❌ POST /settings/channels/whatsapp/start");
      const msg = String(e?.message || "internal_error");
      const isConfig = /não configurado|inferir base/i.test(msg);
      return res.status(isConfig ? 400 : 500).json({ error: msg });
    }
  }
);

async function exchangeCodeForToken({ appId, appSecret, code, redirectUri }) {
  const url =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/oauth/access_token` +
    `?client_id=${encodeURIComponent(appId)}` +
    `&client_secret=${encodeURIComponent(appSecret)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&code=${encodeURIComponent(code)}`;

  const r = await fetch(url, { method: "GET" });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function fetchWabaAndPhoneNumber({ accessToken }) {
  const businessId = optionalEnv("META_BUSINESS_ID");
  if (!businessId) return { ok: false, reason: "META_BUSINESS_ID_not_set" };

  const wabasUrl =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(businessId)}` +
    `/owned_whatsapp_business_accounts?fields=id,name`;

  const wabasRes = await graphGetJson(wabasUrl, accessToken);
  if (!wabasRes.ok) return { ok: false, step: "owned_wabas", ...wabasRes };

  const wabaId = wabasRes.data?.data?.[0]?.id || null;
  if (!wabaId) return { ok: false, step: "owned_wabas_empty", data: wabasRes.data };

  const phonesUrl =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(wabaId)}` +
    `/phone_numbers?fields=id,display_phone_number,verified_name`;

  const phonesRes = await graphGetJson(phonesUrl, accessToken);
  if (!phonesRes.ok) return { ok: false, step: "phone_numbers", ...phonesRes };

  const phoneNumberId = phonesRes.data?.data?.[0]?.id || null;
  const displayPhoneNumber = phonesRes.data?.data?.[0]?.display_phone_number || null;
  const verifiedName = phonesRes.data?.data?.[0]?.verified_name || null;

  return { ok: true, businessId, wabaId, phoneNumberId, displayPhoneNumber, verifiedName };
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

      let parsedState;
      try {
        parsedState = verifyState(state);
      } catch (e) {
        logger.warn({ err: e }, "❌ WhatsApp invalid_state");
        return res.status(400).json({ error: "invalid_state" });
      }

      const tenantId = String(parsedState?.tenantId || "").trim();
      const redirectUriFromState = String(parsedState?.redirectUri || "").trim();
      if (!tenantId) return res.status(400).json({ error: "invalid_state" });

      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");
      const redirectUri = redirectUriFromState || getOAuthRedirectUri(req, "whatsapp");

      logger.info({ tenantId, redirectUri }, "🟡 WhatsApp callback: exchanging code");

      const tokenRes = await exchangeCodeForToken({ appId, appSecret, code, redirectUri });

      if (!tokenRes.ok || !tokenRes?.json?.access_token) {
        logger.error(
          { tokenRes: tokenRes?.json, status: tokenRes?.status, redirectUriUsed: redirectUri, tenantId },
          "❌ Meta token exchange failed"
        );
        return res.status(400).json({
          error: "token_exchange_failed",
          meta: tokenRes?.json?.error || tokenRes?.json || { status: tokenRes?.status }
        });
      }

      const accessToken = String(tokenRes.json.access_token);

      const sync = await fetchWabaAndPhoneNumber({ accessToken });
      if (!sync.ok) {
        logger.warn({ sync }, "⚠️ WhatsApp connected, mas sem sync de WABA/PhoneNumber (best effort)");
      }

      const newConfig = {
        accessToken,
        tokenType: tokenRes.json.token_type || null,
        expiresIn: tokenRes.json.expires_in || null,
        redirectUriUsed: redirectUri,
        connectedAt: nowIso(),

        businessId: sync.ok ? sync.businessId : null,
        wabaId: sync.ok ? sync.wabaId : null,
        phoneNumberId: sync.ok ? sync.phoneNumberId : null,
        displayPhoneNumber: sync.ok ? sync.displayPhoneNumber : null,
        verifiedName: sync.ok ? sync.verifiedName : null,
        apiVersion: META_GRAPH_VERSION
      };

      await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        update: {
          enabled: true,
          status: "connected",
          accessToken,
          wabaId: sync.ok ? sync.wabaId : null,
          phoneNumberId: sync.ok ? sync.phoneNumberId : null,
          displayPhoneNumber: sync.ok ? sync.displayPhoneNumber : null,
          displayName: sync.ok ? sync.verifiedName : null,
          config: newConfig,
          updatedAt: new Date()
        },
        create: {
          tenantId,
          channel: "whatsapp",
          enabled: true,
          status: "connected",
          widgetKey: null,
          accessToken,
          wabaId: sync.ok ? sync.wabaId : null,
          phoneNumberId: sync.ok ? sync.phoneNumberId : null,
          displayPhoneNumber: sync.ok ? sync.displayPhoneNumber : null,
          displayName: sync.ok ? sync.verifiedName : null,
          config: newConfig
        }
      });

      return res.json({
        ok: true,
        redirectUriUsed: redirectUri,
        synced: sync.ok
          ? {
              businessId: sync.businessId,
              wabaId: sync.wabaId,
              phoneNumberId: sync.phoneNumberId,
              displayPhoneNumber: sync.displayPhoneNumber
            }
          : { ok: false, reason: sync.reason || sync.step || "sync_failed" }
      });
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
          accessToken: null,
          wabaId: null,
          phoneNumberId: null,
          displayPhoneNumber: null,
          displayName: null,
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

/*
✅ ENV (produção) — recomendado
- PUBLIC_APP_BASE=https://cliente.gplabs.com.br
- META_OAUTH_REDIRECT_URI=https://cliente.gplabs.com.br/settings/channels/whatsapp/callback
- META_INSTAGRAM_OAUTH_REDIRECT_URI=https://cliente.gplabs.com.br/settings/channels/instagram/callback
- META_APP_ID=...
- META_APP_SECRET=...
- META_BUSINESS_ID=... (opcional p/ sync WA)
- JWT_SECRET=...
*/
