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
// Helpers
// ======================================================
function requireEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

function optionalEnv(name) {
  const v = String(process.env[name] || "").trim();
  return v || "";
}

function getTenantId(req) {
  return req.tenant?.id || req.tenantId || null;
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ======================================================
// STATE (anti-CSRF)
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

    // ✅ colunas first-class (não vazar token)
    pageId: c.pageId || null,
    phoneNumberId: c.phoneNumberId || null,
    wabaId: c.wabaId || null,
    displayName: c.displayName || null,
    displayPhoneNumber: c.displayPhoneNumber || null,
    hasAccessToken: !!c.accessToken,

    // config
    config: cfg,
    updatedAt: c.updatedAt
  };
}

function shapeChannels(list) {
  const out = {};
  for (const c of list) out[c.channel] = shapeChannel(c);
  return out;
}

// ======================================================
// Redirect URI (SINGLE SOURCE OF TRUTH)
// ======================================================
function normalizeRedirectUri(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  return raw.replace(/\/+$/, "");
}

function getMetaOAuthRedirectUri() {
  const v = normalizeRedirectUri(process.env.META_OAUTH_REDIRECT_URI);
  if (!v) throw new Error("META_OAUTH_REDIRECT_URI não configurado");
  return v;
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

      // garante que existem linhas para os canais
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
// ✅ MESSENGER — Produto (self-service multi-tenant)
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
        logger.warn(
          { status: v.status, meta: vj?.error || vj, tenantId, pageId },
          "❌ Messenger connect validate failed"
        );
        return res.status(400).json({ error: "meta_page_token_invalid", meta: vj?.error || vj });
      }

      const displayName = String(vj?.name || "Facebook Page").trim();

      const subUrl = `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
        pageId
      )}/subscribed_apps`;

      const subRes = await graphPostJson(subUrl, pageAccessToken, {
        subscribed_fields: subscribedFields
      });

      if (!subRes.ok) {
        logger.warn(
          { status: subRes.status, meta: subRes.data?.error || subRes.data, tenantId, pageId },
          "❌ Messenger subscribe failed"
        );
        return res.status(400).json({
          error: "meta_subscribe_failed",
          meta: subRes.data?.error || subRes.data
        });
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
// ✅ INSTAGRAM — Produto (self-service multi-tenant)
// IMPORTANTES FIXES:
// - agora salva também o instagramBusinessId em coluna (pageId NÃO serve pra IG webhook)
// - agora cria/atualiza index lookup via pageId (page) + config.instagramBusinessId
// ======================================================

// POST /settings/channels/instagram/pages
router.post(
  "/instagram/pages",
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
        logger.warn({ status: r.status, meta: j?.error || j }, "❌ Instagram pages list failed");
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
      logger.error({ err: e }, "❌ POST /settings/channels/instagram/pages");
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
      const pageAccessToken = String(req.body?.pageAccessToken || "").trim();

      if (!pageId) return res.status(400).json({ error: "pageId_required" });
      if (!pageAccessToken) return res.status(400).json({ error: "pageAccessToken_required" });

      // 1) valida Page token + resolve IG business account
      const pageInfoUrl =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(pageId)}` +
        `?fields=id,name,instagram_business_account` +
        `&access_token=${encodeURIComponent(pageAccessToken)}`;

      const v = await fetch(pageInfoUrl, { method: "GET" });
      const vj = await v.json().catch(() => ({}));

      if (!v.ok || !vj?.id) {
        logger.warn(
          { status: v.status, meta: vj?.error || vj, tenantId, pageId },
          "❌ Instagram connect validate failed"
        );
        return res.status(400).json({ error: "meta_page_token_invalid", meta: vj?.error || vj });
      }

      const displayName = String(vj?.name || "Facebook Page").trim();
      const instagramBusinessId = vj?.instagram_business_account?.id
        ? String(vj.instagram_business_account.id)
        : null;

      if (!instagramBusinessId) {
        return res.status(409).json({
          error: "instagram_not_linked",
          hint:
            "Essa Página não tem uma conta Instagram Business vinculada (instagram_business_account)."
        });
      }

      // 2) (best effort) valida IG business id (opcional)
      // ajuda debug e garante que o token tem permissão pra ler o IG
      const igInfoUrl =
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${encodeURIComponent(
          instagramBusinessId
        )}?fields=id,username,name&access_token=${encodeURIComponent(pageAccessToken)}`;

      const igResp = await fetch(igInfoUrl, { method: "GET" });
      const igJson = await igResp.json().catch(() => ({}));
      const igUsername = igResp.ok && igJson?.id ? String(igJson?.username || "") : "";

      // 3) salva no ChannelConfig (instagram)
      const current = await prisma.channelConfig.findUnique({
        where: { tenantId_channel: { tenantId, channel: "instagram" } }
      });

      const mergedConfig = {
        ...(current?.config || {}),
        instagramBusinessId,
        igUsername: igUsername || undefined,
        connectedAt: nowIso(),
        graphVersion: META_GRAPH_VERSION
      };

      // ✅ opcional: se seu schema já tem igBusinessId como coluna, preenche também
      // se NÃO tiver, remova "wabaId:" abaixo.
      const updated = await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "instagram" } },
        update: {
          enabled: true,
          status: "connected",
          pageId,
          accessToken: pageAccessToken,
          displayName,
          // 🚨 SE você ainda não criou coluna própria p/ IG, deixe só no config
          // wabaId: instagramBusinessId,
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
          // wabaId: instagramBusinessId,
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
          igUsername: igUsername || null
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
      const redirectUri = getMetaOAuthRedirectUri();
      const state = signState({ tenantId, ts: Date.now() });

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

  return fetch(url, { method: "GET" }).then((r) => r.json());
}

async function fetchWabaAndPhoneNumber({ accessToken }) {
  const businessId = optionalEnv("META_BUSINESS_ID");
  if (!businessId) return { ok: false, reason: "META_BUSINESS_ID_not_set" };

  const wabasUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(
    businessId
  )}/owned_whatsapp_business_accounts?fields=id,name`;

  const wabasRes = await graphGetJson(wabasUrl, accessToken);
  if (!wabasRes.ok) return { ok: false, step: "owned_wabas", ...wabasRes };

  const wabaId = wabasRes.data?.data?.[0]?.id || null;
  if (!wabaId) return { ok: false, step: "owned_wabas_empty", data: wabasRes.data };

  const phonesUrl = `https://graph.facebook.com/v19.0/${encodeURIComponent(
    wabaId
  )}/phone_numbers?fields=id,display_phone_number,verified_name`;

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

      const appId = requireEnv("META_APP_ID");
      const appSecret = requireEnv("META_APP_SECRET");

      const parsedState = verifyState(state);
      const tenantId = String(parsedState?.tenantId || "").trim();
      if (!tenantId) return res.status(400).json({ error: "invalid_state" });

      const redirectUri = getMetaOAuthRedirectUri();

      logger.info(
        {
          tenantId,
          redirectUri,
          refOrigin: req.headers.referer ? new URL(req.headers.referer).origin : "",
          refPath: req.headers.referer || ""
        },
        "🟡 WhatsApp callback: exchanging code"
      );

      const tokenRes = await exchangeCodeForToken({
        appId,
        appSecret,
        code,
        redirectUri
      });

      if (!tokenRes?.access_token) {
        logger.error(
          { tokenRes, redirectUriUsed: redirectUri, tenantId },
          "❌ Meta token exchange failed"
        );
        return res.status(400).json({
          error: "token_exchange_failed",
          meta: tokenRes?.error || tokenRes
        });
      }

      const sync = await fetchWabaAndPhoneNumber({ accessToken: tokenRes.access_token });
      if (!sync.ok) {
        logger.warn(
          { sync },
          "⚠️ WhatsApp connected, mas sem sync de WABA/PhoneNumber (best effort)"
        );
      } else {
        logger.info(
          {
            wabaId: sync.wabaId,
            phoneNumberId: sync.phoneNumberId,
            displayPhoneNumber: sync.displayPhoneNumber
          },
          "✅ WhatsApp sync OK (WABA/PhoneNumber)"
        );
      }

      const newConfig = {
        accessToken: tokenRes.access_token,
        tokenType: tokenRes.token_type || null,
        expiresIn: tokenRes.expires_in || null,
        redirectUriUsed: redirectUri,
        connectedAt: nowIso(),

        businessId: sync.ok ? sync.businessId : null,
        wabaId: sync.ok ? sync.wabaId : null,
        phoneNumberId: sync.ok ? sync.phoneNumberId : null,
        displayPhoneNumber: sync.ok ? sync.displayPhoneNumber : null,
        verifiedName: sync.ok ? sync.verifiedName : null,
        apiVersion: "v19.0"
      };

      await prisma.channelConfig.upsert({
        where: { tenantId_channel: { tenantId, channel: "whatsapp" } },
        update: {
          enabled: true,
          status: "connected",
          accessToken: tokenRes.access_token,
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
          accessToken: tokenRes.access_token,
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
