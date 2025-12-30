// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST
// Base: /outbound/sms-campaigns

import express from "express";
import multer from "multer";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

// =========================
// Upload CSV
// =========================
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } });

// =========================
// Feature flag SMS (add-on)
// =========================
function isSmsEnabled() {
  const v = String(process.env.SMS_ENABLED || "true").toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

// =========================
// Prisma helpers
// =========================
function resolveModel() {
  return prisma.outboundCampaign || prisma.OutboundCampaign || null;
}

function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function assertPrisma(res, model) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({ ok: false, error: "prisma_model_missing", details: { expected: "outboundCampaign" } });
    return false;
  }
  return true;
}

async function getSmsCampaign(model, tenantId, id) {
  return model.findFirst({
    where: { id: String(id), tenantId: String(tenantId), channel: "sms" }
  });
}

// =========================
// IAGENTE helpers
// =========================
function assertIagenteEnv() {
  const user = String(process.env.IAGENTE_SMS_USER || "").trim();
  const pass = String(process.env.IAGENTE_SMS_PASS || "").trim();
  const base = String(process.env.IAGENTE_SMS_BASE_URL || "").trim();

  if (!user || !pass || !base) return { ok: false, error: "missing_iagente_env" };
  return { ok: true, user, pass, base };
}

function buildIagenteUrl({ base, user, pass, phone, message }) {
  // iagente usa querystring
  const url = new URL(base);
  url.searchParams.set("usuario", user);
  url.searchParams.set("senha", pass);
  url.searchParams.set("celular", String(phone));
  url.searchParams.set("mensagem", String(message));
  return url.toString();
}

// =========================
// CSV helpers
// =========================
function normalizePhone(raw) {
  const d = String(raw || "").replace(/[^\d]/g, "");
  return d.length >= 10 ? d : null;
}

function detectDelimiter(t) {
  const sample = String(t || "").split(/\r?\n/).slice(0, 5).join("\n");
  return (sample.match(/;/g) || []).length > (sample.match(/,/g) || []).length ? ";" : ",";
}

function parseCsv(text) {
  const out = { rows: [], errors: [] };
  if (!text) return out;

  const delim = detectDelimiter(text.replace(/^\uFEFF/, "")); // remove BOM
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return out;

  const header = lines[0].split(delim).map((h) => h.trim());
  const headerLower = header.map((h) => h.toLowerCase());
  const hasHeader = headerLower.some((h) => ["numero", "phone", "telefone"].includes(h));

  const phoneIdx = hasHeader
    ? headerLower.findIndex((h) => ["numero", "phone", "telefone"].includes(h))
    : 0;

  const varIdxs = header.map((_, i) => i).filter((i) => i !== phoneIdx);

  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const cols = lines[i].split(delim).map((c) => c.trim());
    const phone = normalizePhone(cols[phoneIdx]);

    if (!phone) {
      out.errors.push({ line: i + 1, error: "invalid_phone", value: cols[phoneIdx] || "" });
      continue;
    }

    const vars = {};
    for (const idx of varIdxs) {
      const key = hasHeader ? header[idx] : `var_${idx}`;
      if (!key) continue;
      vars[key] = cols[idx] ?? "";
    }

    out.rows.push({ phone, vars });
  }

  return out;
}

// =========================
// Status helpers
// =========================
const STATUS = {
  DRAFT: "draft",
  RUNNING: "running",
  PAUSED: "paused",
  CANCELED: "canceled",
  FINISHED: "finished",
  FAILED: "failed"
};

function canStart(s) {
  return [STATUS.DRAFT, STATUS.PAUSED].includes(String(s || ""));
}
function canPause(s) {
  return [STATUS.RUNNING].includes(String(s || ""));
}
function canResume(s) {
  return [STATUS.PAUSED].includes(String(s || ""));
}
function canCancel(s) {
  return [STATUS.DRAFT, STATUS.RUNNING, STATUS.PAUSED].includes(String(s || ""));
}

// =========================
// GET campaigns
// =========================
router.get("/", requireAuth, async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await model.findMany({
      where: { tenantId, channel: "sms" },
      orderBy: { createdAt: "desc" }
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// CREATE campaign
// =========================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const item = await model.create({
      data: {
        tenantId,
        channel: "sms",
        name,
        status: STATUS.DRAFT,
        metadata: { ...(req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {}), message }
      }
    });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// UPLOAD AUDIENCE
// =========================
router.post("/:id/audience", requireAuth, requireRole("admin", "manager"), upload.single("file"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    // não deixa trocar audiência enquanto rodando
    if (String(campaign.status) === STATUS.RUNNING) {
      return res.status(409).json({ ok: false, error: "cannot_update_audience_while_running" });
    }

    let csvText = "";
    if (req.file?.buffer) csvText = req.file.buffer.toString("utf8");
    else if (typeof req.body?.csvText === "string") csvText = req.body.csvText;
    else if (typeof req.body?.csv === "string") csvText = req.body.csv;

    if (!csvText.trim()) return res.status(400).json({ ok: false, error: "csv_required" });

    const parsed = parseCsv(csvText);
    if (!parsed.rows.length) {
      return res.status(400).json({ ok: false, error: "csv_empty_or_invalid", details: parsed.errors });
    }

    const audience = {
      rows: parsed.rows,
      total: parsed.rows.length,
      errors: parsed.errors,
      importedAt: new Date().toISOString()
    };

    const item = await model.update({
      where: { id },
      data: { audience }
    });

    return res.json({ ok: true, item, imported: parsed.rows.length, errors: parsed.errors.length });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/audience failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// START (envio via IAGENTE)
// =========================
router.post("/:id/start", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canStart(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    if (!campaign.audience?.rows?.length) {
      return res.status(400).json({ ok: false, error: "audience_required" });
    }

    const message = String(campaign.metadata?.message || "").trim();
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const env = assertIagenteEnv();
    if (!env.ok) return res.status(500).json({ ok: false, error: env.error });

    // marca RUNNING
    await model.update({
      where: { id },
      data: {
        status: STATUS.RUNNING,
        startedAt: campaign.startedAt || new Date(),
        pausedAt: null,
        canceledAt: null,
        finishedAt: null
      }
    });

    // envio sync (MVP): respeita PAUSE/CANCEL consultando status a cada N itens
    const rows = campaign.audience.rows;
    const maxToSend = Number(req.query?.limit || 0) > 0 ? Number(req.query.limit) : rows.length; // opcional p/ teste
    const results = [];
    const batchCheckEvery = 10;

    for (let i = 0; i < rows.length && i < maxToSend; i++) {
      // checa status periodicamente (pause/cancel)
      if (i % batchCheckEvery === 0) {
        const current = await getSmsCampaign(model, tenantId, id);
        const st = String(current?.status || "");
        if (st === STATUS.PAUSED) {
          return res.status(202).json({ ok: true, paused: true, sent: results.length });
        }
        if (st === STATUS.CANCELED) {
          return res.status(202).json({ ok: true, canceled: true, sent: results.length });
        }
      }

      const row = rows[i];

      // substituição de variáveis: {{var_1}} ou {{nome_coluna}}
      let text = message;
      for (const [k, v] of Object.entries(row.vars || {})) {
        text = text.replaceAll(`{{${k}}}`, String(v ?? ""));
      }

      const url = buildIagenteUrl({
        base: env.base,
        user: env.user,
        pass: env.pass,
        phone: row.phone,
        message: text
      });

      try {
        const r = await fetch(url);
        const body = await r.text();
        results.push({ i, phone: row.phone, ok: r.ok, status: r.status, body: body?.slice(0, 500) });
      } catch (e) {
        results.push({ i, phone: row.phone, ok: false, error: String(e?.message || e) });
      }
    }

    // status final (se ninguém pausou/cancelou)
    const success = results.filter((x) => x.ok).length;
    const failed = results.length - success;

    await model.update({
      where: { id },
      data: {
        status: STATUS.FINISHED,
        finishedAt: new Date(),
        report: {
          total: results.length,
          success,
          failed,
          samples: results.slice(0, 50),
          finishedAt: new Date().toISOString()
        }
      }
    });

    return res.json({ ok: true, sent: results.length, success, failed });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/start failed");
    // best effort: marca failed
    try {
      const model = resolveModel();
      const tenantId = getTenantId(req);
      const id = String(req.params.id || "");
      if (model && tenantId && id) {
        await model.update({
          where: { id },
          data: { status: STATUS.FAILED, finishedAt: new Date(), report: { error: String(err?.message || err) } }
        });
      }
    } catch {}
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// PAUSE
// =========================
router.patch("/:id/pause", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canPause(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const item = await model.update({
      where: { id },
      data: { status: STATUS.PAUSED, pausedAt: new Date() }
    });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id/pause failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// RESUME (volta para RUNNING e dispara /start de novo via frontend)
// =========================
router.patch("/:id/resume", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canResume(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const item = await model.update({
      where: { id },
      data: { status: STATUS.RUNNING, pausedAt: null }
    });

    // Nota: o envio real ocorre quando o frontend chamar POST /:id/start novamente.
    // Isso mantém o comportamento simples sem worker.
    return res.json({ ok: true, item, note: "resumed; call POST /:id/start to continue sending" });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id/resume failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// CANCEL
// =========================
router.patch("/:id/cancel", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canCancel(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const item = await model.update({
      where: { id },
      data: { status: STATUS.CANCELED, canceledAt: new Date() }
    });

    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id/cancel failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
