// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns

import express from "express";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
}
function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return true;
  }
}
function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}
function assertPrisma(res, model, candidates) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({ ok: false, error: "prisma_model_missing", details: { expectedAnyOf: candidates } });
    return false;
  }
  return true;
}

const MODEL_CANDIDATES = ["outboundCampaign", "OutboundCampaign", "campaign", "Campaign"];
const PRISMA_MODEL_NAME = "OutboundCampaign";

/** IAGENTE env */
function getIagenteEnv() {
  const user = String(process.env.IAGENTE_SMS_USER || "").trim();
  const pass = String(process.env.IAGENTE_SMS_PASS || "").trim();
  const baseUrl = String(process.env.IAGENTE_SMS_BASE_URL || "").trim(); // ex: https://api.iagentesms.com.br/webservices/http.php
  return { user, pass, baseUrl };
}

function normalizePhone(raw) {
  const s = String(raw || "").replace(/[^\d]/g, "");
  // aceita BR com DDI (55) ou sem; aqui não força nada, só limpa
  return s;
}

function parseCsvPhones(csvText) {
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return { rows: [], errors: ["csv_empty"] };

  // tenta detectar header
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("phone") || header.includes("cel") || header.includes("telefone") || header.includes("numero");

  const startIdx = hasHeader ? 1 : 0;

  const rows = [];
  const errors = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = lines[i].split(/[,;|\t]/).map((c) => c.trim());
    const phoneRaw = cols[0];
    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      errors.push(`invalid_phone_line_${i + 1}`);
      continue;
    }
    rows.push({ phone });
  }

  return { rows, errors };
}

async function iagenteSendOne({ baseUrl, user, pass, to, message }) {
  const url = new URL(baseUrl);
  url.searchParams.set("metodo", "envio");
  url.searchParams.set("usuario", user);
  url.searchParams.set("senha", pass);
  url.searchParams.set("celular", to);
  url.searchParams.set("mensagem", message);

  const r = await fetch(url.toString(), { method: "GET" });
  const text = await r.text().catch(() => "");
  // iagente costuma responder texto; vamos guardar bruto
  return { ok: r.ok, status: r.status, body: text };
}

// ------------------------------------------------------
// GET /outbound/sms-campaigns
// ------------------------------------------------------
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = { tenantId, channel: "sms" };

    const items = await model.findMany({
      where,
      orderBy: modelHasField(PRISMA_MODEL_NAME, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ------------------------------------------------------
// POST /outbound/sms-campaigns (create draft)
// body: { name, message, metadata? }
// ------------------------------------------------------
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });

    // ✅ garante obrigatórios do schema
    const data = {
      tenantId,
      channel: "sms",
      name,
      status: "draft"
    };

    if (modelHasField(PRISMA_MODEL_NAME, "metadata")) data.metadata = { ...metadata, message };
    if (modelHasField(PRISMA_MODEL_NAME, "audience")) data.audience = { rows: [], total: 0 };

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ------------------------------------------------------
// POST /outbound/sms-campaigns/:id/audience
// Aceita:
// - text/csv (body bruto)
// - application/json { csv: "..." }
// ------------------------------------------------------
router.post("/:id/audience", requireAuth, requireRole("admin", "manager"), express.text({ type: ["text/csv", "text/plain"], limit: "10mb" }), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");

    const existing = await model.findFirst({
      where: { id, tenantId, channel: "sms" },
      select: { id: true, metadata: true }
    });
    if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

    const csvText =
      typeof req.body === "string" && req.body.trim()
        ? req.body
        : String(req.body?.csv || "").trim();

    if (!csvText) return res.status(400).json({ ok: false, error: "csv_required" });

    const parsed = parseCsvPhones(csvText);

    const audience = {
      rows: parsed.rows,
      total: parsed.rows.length,
      errors: parsed.errors
    };

    const data = {};
    if (modelHasField(PRISMA_MODEL_NAME, "audience")) data.audience = audience;

    const item = await model.update({ where: { id }, data });

    return res.json({ ok: true, item, audience });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/audience failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ------------------------------------------------------
// POST /outbound/sms-campaigns/:id/start
// Dispara via IAGENTE usando audience.rows[].phone e metadata.message
// opcional: { limit?: number } para evitar timeout
// ------------------------------------------------------
router.post("/:id/start", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const limit = Math.max(1, Math.min(500, Number(req.body?.limit || 50))); // default 50 por chamada

    const item = await model.findFirst({
      where: { id, tenantId, channel: "sms" }
    });
    if (!item) return res.status(404).json({ ok: false, error: "not_found" });

    const { user, pass, baseUrl } = getIagenteEnv();
    if (!user || !pass || !baseUrl) {
      return res.status(500).json({ ok: false, error: "missing_iagente_env" });
    }

    const message = String(item?.metadata?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "message_missing_on_campaign" });

    const rows = Array.isArray(item?.audience?.rows) ? item.audience.rows : [];
    if (!rows.length) return res.status(400).json({ ok: false, error: "audience_empty" });

    // manda só um lote (evita timeout). você pode chamar /start repetidamente
    const batch = rows.slice(0, limit);

    const results = [];
    let sent = 0;
    let failed = 0;

    // concorrência simples (5)
    const concurrency = 5;
    let idx = 0;

    async function worker() {
      while (idx < batch.length) {
        const cur = batch[idx++];
        const to = normalizePhone(cur?.phone || cur?.to || "");
        if (!to) {
          failed++;
          results.push({ to: null, ok: false, error: "invalid_phone" });
          continue;
        }
        try {
          const r = await iagenteSendOne({ baseUrl, user, pass, to, message });
          if (r.ok) sent++;
          else failed++;
          results.push({ to, ok: r.ok, status: r.status, body: r.body });
        } catch (e) {
          failed++;
          results.push({ to, ok: false, error: String(e?.message || e) });
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    // atualiza stats
    const stats = {
      ...(item?.stats && typeof item.stats === "object" ? item.stats : {}),
      lastStartAt: new Date().toISOString(),
      lastBatch: { size: batch.length, sent, failed }
    };

    const data = {};
    if (modelHasField(PRISMA_MODEL_NAME, "status")) data.status = "sending";
    if (modelHasField(PRISMA_MODEL_NAME, "stats")) data.stats = stats;

    const updated = await model.update({ where: { id }, data });

    return res.json({
      ok: true,
      item: updated,
      batch: { size: batch.length, sent, failed },
      results
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/start failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
