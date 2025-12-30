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
  return prisma?.outboundCampaign || prisma?.OutboundCampaign || null;
}
function getModelName() {
  return "OutboundCampaign";
}

function resolveLogModel() {
  return prisma?.outboundLog || prisma?.OutboundLog || null;
}
function getLogModelName() {
  return "OutboundLog";
}

function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return false;
  }
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
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expected: "outboundCampaign|OutboundCampaign" }
    });
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
// Provider helpers (env)
// =========================
function assertSmsProviderEnv() {
  const user = String(process.env.IAGENTE_SMS_USER || "").trim();
  const pass = String(process.env.IAGENTE_SMS_PASS || "").trim();
  const base = String(process.env.IAGENTE_SMS_BASE_URL || "").trim();
  if (!user || !pass || !base) return { ok: false, error: "missing_sms_provider_env" };
  return { ok: true, user, pass, base };
}

function buildProviderUrl({ base, user, pass, phone, message }) {
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

  const cleaned = String(text || "").replace(/^\uFEFF/, "");
  const delim = detectDelimiter(cleaned);

  const lines = cleaned
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
// Metadata helpers (timestamps + progress)
// =========================
function safeObj(x) {
  return x && typeof x === "object" ? x : {};
}

function setMetaTs(campaign, patch) {
  const md = safeObj(campaign?.metadata);
  const ts = safeObj(md?.timestamps);
  return {
    ...md,
    timestamps: { ...ts, ...patch }
  };
}

// =========================
// Progress helpers (metadata.smsProgress)
// =========================
function getProgress(campaign) {
  const md = safeObj(campaign?.metadata);
  const p = safeObj(md?.smsProgress);
  const cursor = Number.isFinite(Number(p.cursor)) ? Number(p.cursor) : 0;

  return {
    cursor: Math.max(0, cursor),
    sent: Number.isFinite(Number(p.sent)) ? Number(p.sent) : 0,
    success: Number.isFinite(Number(p.success)) ? Number(p.success) : 0,
    failed: Number.isFinite(Number(p.failed)) ? Number(p.failed) : 0,
    lastRunAt: p.lastRunAt || null
  };
}

async function persistProgress(model, modelName, id, campaign, patch) {
  const baseMd = safeObj(campaign?.metadata);
  const baseProg = getProgress(campaign);

  const nextProg = {
    ...baseProg,
    ...patch,
    lastRunAt: new Date().toISOString()
  };

  const nextMd = { ...baseMd, smsProgress: nextProg };

  const data = {};
  if (modelHasField(modelName, "metadata")) data.metadata = nextMd;

  if (Object.keys(data).length) {
    await model.update({ where: { id: String(id) }, data });
  }

  return nextProg;
}

function renderMessage(template, vars) {
  let text = String(template || "");
  for (const [k, v] of Object.entries(vars || {})) {
    text = text.replaceAll(`{{${k}}}`, String(v ?? ""));
  }
  return text;
}

function resolveMessageTemplate(campaign) {
  const md = safeObj(campaign?.metadata);
  // ✅ no seu schema, SMS é metadata.message
  return String(md?.message || "").trim() || String(md?.smsMessage || "").trim();
}

// =========================
// OutboundLog helpers (analytics)
// =========================
async function writeLog({ tenantId, campaignId, phone, status, error, provider, providerMsgId, cost, metadata }) {
  const logModel = resolveLogModel();
  const logModelName = getLogModelName();
  if (!logModel) return;
  if (!modelHasField(logModelName, "tenantId")) return;

  // ✅ Decimal: não força number (pode ser string/number) ou null
  const costValue =
    cost === null || cost === undefined || cost === ""
      ? null
      : typeof cost === "number"
        ? cost
        : typeof cost === "string"
          ? cost
          : null;

  try {
    await logModel.create({
      data: {
        tenantId: String(tenantId),
        campaignId: String(campaignId),
        channel: "sms",
        phone: String(phone || ""),
        status: String(status || "processed"),
        error: error ? String(error).slice(0, 500) : null,
        provider: provider ? String(provider).slice(0, 50) : null,
        providerMsgId: providerMsgId ? String(providerMsgId).slice(0, 120) : null,
        cost: costValue,
        metadata: metadata && typeof metadata === "object" ? metadata : undefined
      }
    });
  } catch (e) {
    logger.warn({ err: e?.message || e }, "⚠️ OutboundLog create failed (ignored)");
  }
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

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message) return res.status(400).json({ ok: false, error: "message_required" });

    const baseMetadata = safeObj(req.body?.metadata);

    const data = {
      tenantId,
      channel: "sms",
      name,
      status: STATUS.DRAFT
    };

    if (modelHasField(modelName, "metadata")) {
      data.metadata = {
        ...baseMetadata,
        message,
        smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0, lastRunAt: new Date().toISOString() },
        timestamps: { createdAt: new Date().toISOString() }
      };
    }

    const item = await model.create({ data });
    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// UPDATE campaign
// =========================
router.patch("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    const st = String(campaign.status || "");
    if (![STATUS.DRAFT, STATUS.PAUSED, STATUS.FAILED].includes(st)) {
      return res.status(409).json({ ok: false, error: "cannot_edit_in_this_status", status: campaign.status });
    }

    const name = req.body?.name !== undefined ? String(req.body?.name || "").trim() : undefined;

    const bodyMessage =
      req.body?.message !== undefined
        ? String(req.body?.message || "").trim()
        : req.body?.metadata?.message !== undefined
          ? String(req.body?.metadata?.message || "").trim()
          : undefined;

    const patchMdRaw = safeObj(req.body?.metadata);
    const baseMd = safeObj(campaign?.metadata);

    const data = {};

    if (name !== undefined) {
      if (!name) return res.status(400).json({ ok: false, error: "name_required" });
      data.name = name;
    }

    if (modelHasField(modelName, "metadata")) {
      const mergedMd = { ...baseMd, ...patchMdRaw };

      if (bodyMessage !== undefined) {
        if (!bodyMessage) return res.status(400).json({ ok: false, error: "message_required" });
        mergedMd.message = bodyMessage;
      }

      mergedMd.timestamps = { ...(safeObj(mergedMd.timestamps) || {}), updatedAt: new Date().toISOString() };

      data.metadata = mergedMd;
    } else {
      if (bodyMessage !== undefined) return res.status(409).json({ ok: false, error: "schema_has_no_metadata_field" });
    }

    if (!Object.keys(data).length) return res.json({ ok: true, item: campaign, note: "no_changes" });

    const item = await model.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// DELETE campaign
// =========================
router.delete("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const logModel = resolveLogModel();
  const logModelName = getLogModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    const st = String(campaign.status || "");
    if (st !== STATUS.DRAFT) {
      return res.status(409).json({ ok: false, error: "only_draft_can_be_deleted", status: campaign.status });
    }

    try {
      if (logModel && modelHasField(logModelName, "campaignId")) {
        await logModel.deleteMany({
          where: { tenantId: String(tenantId), campaignId: String(id), channel: "sms" }
        });
      }
    } catch (e) {
      logger.warn({ err: e?.message || e }, "⚠️ smsCampaignsRouter DELETE: log cleanup failed (ignored)");
    }

    await model.delete({ where: { id: String(id) } });
    return res.json({ ok: true, deleted: true, id });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter DELETE /:id failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// UPLOAD AUDIENCE
// =========================
router.post(
  "/:id/audience",
  requireAuth,
  requireRole("admin", "manager"),
  upload.single("file"),
  async (req, res) => {
    if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

    const model = resolveModel();
    if (!assertPrisma(res, model)) return;

    const modelName = getModelName();

    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

      const id = String(req.params.id || "");
      const campaign = await getSmsCampaign(model, tenantId, id);
      if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

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

      const baseMd = safeObj(campaign?.metadata);
      const nextMd = {
        ...baseMd,
        smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0, lastRunAt: new Date().toISOString() }
      };

      const data = {};
      if (modelHasField(modelName, "audience")) data.audience = audience;
      if (modelHasField(modelName, "audienceCount")) data.audienceCount = parsed.rows.length;
      if (modelHasField(modelName, "metadata")) data.metadata = nextMd;

      const item = await model.update({ where: { id }, data });
      return res.json({ ok: true, item, audienceCount: parsed.rows.length, imported: parsed.rows.length });
    } catch (err) {
      logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/audience failed");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);

// =========================
// REPORT
// =========================
router.get("/:id/report", requireAuth, async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    const prog = getProgress(campaign);

    const totalAudience =
      Number(campaign?.audienceCount || 0) ||
      Number(campaign?.audience?.total || 0) ||
      (Array.isArray(campaign?.audience?.rows) ? campaign.audience.rows.length : 0);

    const stats = safeObj(campaign?.stats);
    const smsReport = safeObj(stats?.smsReport);
    const samples = Array.isArray(smsReport?.samples) ? smsReport.samples : [];

    const results = samples.map((s) => ({
      phone: s.phone,
      ok: !!s.ok,
      status: s.ok ? "success" : "failed",
      providerRaw: s.body || "",
      httpStatus: s.status || 0
    }));

    return res.json({
      ok: true,
      id: campaign.id,
      status: campaign.status,
      total: totalAudience,
      sent: prog.sent,
      success: prog.success,
      failed: prog.failed,
      cursor: prog.cursor,
      results
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET /:id/report failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// REPORT CSV
// =========================
router.get("/:id/report.csv", requireAuth, async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    const stats = safeObj(campaign?.stats);
    const smsReport = safeObj(stats?.smsReport);
    const samples = Array.isArray(smsReport?.samples) ? smsReport.samples : [];

    const lines = [];
    lines.push(["phone", "status", "details"].join(";"));

    for (const s of samples) {
      const phone = String(s.phone || "");
      const st = s.ok ? "success" : "failed";
      const det = String(s.body || "").replace(/\r?\n/g, " ").slice(0, 400);
      lines.push([phone, st, det].join(";"));
    }

    const csv = lines.join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sms_report_${id}.csv"`);
    return res.send(csv);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET /:id/report.csv failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// START (envio)
// =========================
router.post("/:id/start", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  const PROGRESS_FLUSH_EVERY = Number(process.env.SMS_PROGRESS_FLUSH_EVERY || 10);
  const STATUS_CHECK_EVERY = Number(process.env.SMS_STATUS_CHECK_EVERY || 10);

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (String(campaign.status) === STATUS.RUNNING) {
      return res.status(409).json({ ok: false, error: "already_running" });
    }
    if (!canStart(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    // ✅ audiência robusta: aceita {rows: []} OU array direto
    const rawAudience = campaign.audience;
    const rows =
      Array.isArray(rawAudience) ? rawAudience
      : Array.isArray(rawAudience?.rows) ? rawAudience.rows
      : [];

    if (!rows.length) {
      return res.status(400).json({
        ok: false,
        error: "audience_required",
        details: {
          audienceCount: Number(campaign?.audienceCount || 0),
          hasAudience: !!campaign.audience,
          hasRows: !!campaign.audience?.rows,
          rowsLen: Array.isArray(campaign.audience?.rows) ? campaign.audience.rows.length : 0
        }
      });
    }

    const messageTemplate = resolveMessageTemplate(campaign);
    if (!messageTemplate) {
      return res.status(400).json({
        ok: false,
        error: "message_required",
        details: {
          hasMetadata: !!campaign.metadata,
          metadataKeys: campaign?.metadata ? Object.keys(campaign.metadata) : []
        }
      });
    }

    const env = assertSmsProviderEnv();
    if (!env.ok) return res.status(500).json({ ok: false, error: env.error });

    // ✅ aceita limit via BODY OU querystring
    const reqLimit =
      Number(req.body?.limit || 0) > 0 ? Number(req.body.limit)
      : Number(req.query?.limit || 0) > 0 ? Number(req.query.limit)
      : 0;

    const maxToSend = reqLimit > 0 ? reqLimit : Number.MAX_SAFE_INTEGER;

    // ✅ atualiza status + timestamps (em metadata)
    const nextMd = setMetaTs(campaign, {
      startedAt: new Date().toISOString(),
      pausedAt: null,
      canceledAt: null,
      finishedAt: null
    });

    await model.update({
      where: { id },
      data: {
        status: STATUS.RUNNING,
        ...(modelHasField(modelName, "metadata") ? { metadata: nextMd } : {})
      }
    });

    let current = await getSmsCampaign(model, tenantId, id);
    if (!current) return res.status(404).json({ ok: false, error: "not_found" });

    // recalcula rows da versão atualizada
    const rawAudience2 = current.audience;
    const rows2 =
      Array.isArray(rawAudience2) ? rawAudience2
      : Array.isArray(rawAudience2?.rows) ? rawAudience2.rows
      : [];

    if (!rows2.length) {
      return res.status(400).json({ ok: false, error: "audience_required_after_update" });
    }

    let prog = getProgress(current);

    let localSent = 0;
    let localSuccess = 0;
    let localFailed = 0;

    const samples = [];
    const SAMPLE_LIMIT = 50;

    const startCursor = prog.cursor;
    let endCursor = prog.cursor;

    for (let i = prog.cursor; i < rows2.length && localSent < maxToSend; i++) {
      endCursor = i;

      if (localSent % STATUS_CHECK_EVERY === 0) {
        const st = await getSmsCampaign(model, tenantId, id);
        const statusNow = String(st?.status || "");
        if (statusNow === STATUS.PAUSED || statusNow === STATUS.CANCELED) {
          await persistProgress(model, modelName, id, st, {
            cursor: i,
            sent: prog.sent + localSent,
            success: prog.success + localSuccess,
            failed: prog.failed + localFailed
          });
          return res.status(202).json({
            ok: true,
            paused: statusNow === STATUS.PAUSED,
            canceled: statusNow === STATUS.CANCELED,
            cursor: i,
            sent: prog.sent + localSent,
            success: prog.success + localSuccess,
            failed: prog.failed + localFailed
          });
        }
      }

      const row = rows2[i] || {};
      const phone = row.phone || row.numero || row.number || row.phoneE164 || "";
      const vars = row.vars || row.variables || row.meta || {};

      const text = renderMessage(messageTemplate, vars);
      const url = buildProviderUrl({
        base: env.base,
        user: env.user,
        pass: env.pass,
        phone,
        message: text
      });

      let ok = false;
      let statusCode = 0;
      let body = "";

      try {
        const r = await fetch(url);
        statusCode = r.status;
        body = await r.text();
        ok = r.ok;
      } catch (e) {
        ok = false;
        body = String(e?.message || e);
      }

      await writeLog({
        tenantId,
        campaignId: id,
        phone,
        status: ok ? "processed" : "failed",
        error: ok ? null : `http_${statusCode || 0}`,
        provider: "iagente",
        metadata: {
          httpStatus: statusCode,
          response: String(body || "").slice(0, 500)
        }
      });

      localSent++;
      if (ok) localSuccess++;
      else localFailed++;

      if (samples.length < SAMPLE_LIMIT) {
        samples.push({
          i,
          phone,
          ok,
          status: statusCode,
          body: String(body || "").slice(0, 500)
        });
      }

      if (localSent % PROGRESS_FLUSH_EVERY === 0) {
        const refreshed = await getSmsCampaign(model, tenantId, id);
        if (!refreshed) break;

        prog = await persistProgress(model, modelName, id, refreshed, {
          cursor: i + 1,
          sent: prog.sent + localSent,
          success: prog.success + localSuccess,
          failed: prog.failed + localFailed
        });

        localSent = 0;
        localSuccess = 0;
        localFailed = 0;
      }
    }

    current = await getSmsCampaign(model, tenantId, id);
    if (!current) return res.status(404).json({ ok: false, error: "not_found" });

    // cursor final correto
    const finalCursor = Math.min(rows2.length, endCursor + 1);

    prog = await persistProgress(model, modelName, id, current, {
      cursor: finalCursor,
      sent: prog.sent + localSent,
      success: prog.success + localSuccess,
      failed: prog.failed + localFailed
    });

    const done = prog.cursor >= rows2.length;

    // salva relatório no stats.smsReport (se existir)
    if (modelHasField(modelName, "stats")) {
      const baseStats = safeObj(current?.stats);
      await model.update({
        where: { id },
        data: {
          ...(done ? { status: STATUS.FINISHED } : {}),
          stats: {
            ...baseStats,
            smsReport: {
              total: prog.sent,
              success: prog.success,
              failed: prog.failed,
              finishedAt: done ? new Date().toISOString() : null,
              samples
            }
          },
          ...(modelHasField(modelName, "metadata") && done
            ? { metadata: setMetaTs(current, { finishedAt: new Date().toISOString() }) }
            : {})
        }
      });
    } else if (done) {
      await model.update({
        where: { id },
        data: {
          status: STATUS.FINISHED,
          ...(modelHasField(modelName, "metadata")
            ? { metadata: setMetaTs(current, { finishedAt: new Date().toISOString() }) }
            : {})
        }
      });
    }

    return res.json({
      ok: true,
      finished: done,
      cursor: prog.cursor,
      totalAudience: rows2.length,
      sent: prog.sent,
      success: prog.success,
      failed: prog.failed,
      startedCursor: startCursor,
      finalCursor,
      limit: maxToSend
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/start failed");

    // best-effort: marca failed sem usar campos inexistentes
    try {
      const model2 = resolveModel();
      const tenantId2 = getTenantId(req);
      const id2 = String(req.params.id || "");
      if (model2 && tenantId2 && id2) {
        const current = await getSmsCampaign(model2, tenantId2, id2);
        if (current) {
          const patchMd = modelHasField(getModelName(), "metadata")
            ? {
                metadata: setMetaTs(current, {
                  finishedAt: new Date().toISOString(),
                  failedAt: new Date().toISOString()
                })
              }
            : {};
          await model2.update({
            where: { id: id2 },
            data: { status: STATUS.FAILED, ...patchMd }
          });
        }
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

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canPause(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const data = { status: STATUS.PAUSED };

    if (modelHasField(modelName, "metadata")) {
      data.metadata = setMetaTs(campaign, { pausedAt: new Date().toISOString() });
    }

    const item = await model.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id/pause failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// RESUME (só muda status; depois POST /start)
// =========================
router.patch("/:id/resume", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canResume(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const data = { status: STATUS.DRAFT };

    if (modelHasField(modelName, "metadata")) {
      data.metadata = setMetaTs(campaign, { resumedAt: new Date().toISOString(), pausedAt: null });
    }

    const item = await model.update({ where: { id }, data });
    return res.json({ ok: true, item, note: "call POST /:id/start to continue from cursor" });
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

  const modelName = getModelName();

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    if (!canCancel(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    const data = { status: STATUS.CANCELED };

    if (modelHasField(modelName, "metadata")) {
      data.metadata = setMetaTs(campaign, { canceledAt: new Date().toISOString() });
    }

    const item = await model.update({ where: { id }, data });
    return res.json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter PATCH /:id/cancel failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
