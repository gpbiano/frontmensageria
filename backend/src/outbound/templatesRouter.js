// backend/src/outbound/templatesRouter.js
import express from "express";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

/**
 * ===============================
 * HELPERS
 * ===============================
 */

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId || req.user?.tenantId;
  return tenantId ? String(tenantId) : null;
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

/**
 * Busca config do WhatsApp do tenant no ChannelConfig.
 * - channel sugerido: "whatsapp"
 * - fallback: process.env.WABA_ID / process.env.WHATSAPP_TOKEN
 */
async function getWhatsAppEnvForTenant(tenantId) {
  let wabaId = "";
  let token = "";
  let apiVersion = "v22.0";

  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId, channel: "whatsapp" },
      select: { config: true }
    });

    const cfg = row?.config && typeof row.config === "object" ? row.config : {};

    wabaId = String(cfg.wabaId || cfg.WABA_ID || "").trim();
    token = String(cfg.token || cfg.WHATSAPP_TOKEN || "").trim();
    apiVersion = String(cfg.apiVersion || cfg.WHATSAPP_API_VERSION || apiVersion).trim();
  } catch (e) {
    logger.warn({ e }, "templatesRouter: falha ao ler ChannelConfig, usando ENV");
  }

  // fallback ENV (para não travar enquanto você migra configs por tenant)
  if (!wabaId) wabaId = String(process.env.WABA_ID || process.env.WHATSAPP_WABA_ID || "").trim();
  if (!token) token = String(process.env.WHATSAPP_TOKEN || "").trim();
  if (!apiVersion) apiVersion = "v22.0";

  return { wabaId, token, apiVersion };
}

async function ensureEnv(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    res.status(400).json({ error: "tenant_not_resolved" });
    return null;
  }

  const { wabaId, token, apiVersion } = await getWhatsAppEnvForTenant(tenantId);

  if (!wabaId || !token) {
    logger.warn(
      { tenantId, hasWaba: !!wabaId, hasToken: !!token },
      "⚠️ Templates – WABA_ID/WHATSAPP_TOKEN ausentes (tenant/ENV)"
    );

    res.status(500).json({
      error:
        "Configuração do WhatsApp não encontrada. Cadastre no ChannelConfig (channel=whatsapp) ou configure WABA_ID/WHATSAPP_TOKEN no .env."
    });
    return null;
  }

  return { tenantId, wabaId, token, apiVersion };
}

function metaUrl({ apiVersion, wabaId }) {
  return `https://graph.facebook.com/${apiVersion}/${wabaId}/message_templates`;
}

/**
 * ===============================
 * ROUTES
 * ===============================
 */

// ===============================
// LISTAR TEMPLATES DA META
// GET /outbound/templates
// ===============================
router.get("/", async (req, res) => {
  const env = await ensureEnv(req, res);
  if (!env) return;

  const { tenantId, wabaId, token, apiVersion } = env;

  try {
    const url = metaUrl({ apiVersion, wabaId });
    const fetchFn = await getFetch();

    const metaRes = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const raw = await metaRes.text().catch(() => "");
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }

    if (!metaRes.ok) {
      logger.error({ tenantId, status: metaRes.status, json }, "❌ Erro ao listar templates na Meta");
      return res.status(500).json({ error: "Erro ao listar templates", details: json });
    }

    return res.json(json.data || []);
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado ao listar templates");
    return res.status(500).json({ error: "Erro interno ao listar templates" });
  }
});

// ===============================
// SINCRONIZAR (por enquanto = listar)
// POST /outbound/templates/sync
// ===============================
router.post("/sync", async (req, res) => {
  const env = await ensureEnv(req, res);
  if (!env) return;

  const { tenantId, wabaId, token, apiVersion } = env;

  try {
    const url = metaUrl({ apiVersion, wabaId });
    const fetchFn = await getFetch();

    const metaRes = await fetchFn(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const raw = await metaRes.text().catch(() => "");
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }

    if (!metaRes.ok) {
      logger.error({ tenantId, status: metaRes.status, json }, "❌ Erro ao sincronizar templates");
      return res.status(500).json({ error: "Erro ao sincronizar templates", details: json });
    }

    return res.json(json.data || []);
  } catch (err) {
    logger.error({ err }, "❌ Erro interno ao sincronizar templates");
    return res.status(500).json({ error: "Erro interno ao sincronizar templates" });
  }
});

// ===============================
// CRIAR TEMPLATE
// POST /outbound/templates
// ===============================
router.post("/", async (req, res) => {
  const env = await ensureEnv(req, res);
  if (!env) return;

  const { tenantId, wabaId, token, apiVersion } = env;

  const payload = req.body;

  // ✅ não loga token nem payload gigante (só fields úteis)
  logger.info(
    {
      tenantId,
      wabaId,
      apiVersion,
      name: payload?.name,
      language: payload?.language,
      category: payload?.category
    },
    "📨 Recebido pedido de criação de template"
  );

  try {
    const url = metaUrl({ apiVersion, wabaId });
    const fetchFn = await getFetch();

    const metaRes = await fetchFn(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const raw = await metaRes.text().catch(() => "");
    let json = {};
    try {
      json = raw ? JSON.parse(raw) : {};
    } catch {
      json = {};
    }

    if (!metaRes.ok) {
      logger.error({ tenantId, status: metaRes.status, json }, "❌ Erro ao criar template na Meta");
      return res.status(500).json({ error: "Erro ao criar template", details: json });
    }

    logger.info({ tenantId, templateId: json?.id || null }, "✅ Template criado com sucesso na Meta");
    return res.json(json);
  } catch (err) {
    logger.error({ err }, "❌ Erro interno ao criar template");
    return res.status(500).json({ error: "Erro interno ao criar template" });
  }
});

export default router;
