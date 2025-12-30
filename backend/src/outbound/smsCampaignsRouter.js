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

  const delim = detectDelimiter(text.replace(/^\uFEFF/, ""));
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
// Progress helpers (persistido em metadata)
// =========================
function getProgress(campaign) {
  const md = (campaign?.metadata && typeof campaign.metadata === "object") ? campaign.metadata : {};
  const p = (md.smsProgress && typeof md.smsProgress === "object") ? md.smsProgress : {};
  const cursor = Number.isFinite(Number(p.cursor)) ? Number(p.cursor) : 0;

  return {
    cursor: Math.max(0, cursor),
    sent: Number.isFinite(Number(p.sent)) ? Number(p.sent) : 0,
    success: Number.isFinite(Number(p.success)) ? Number(p.success) : 0,
    failed: Number.isFinite(Number(p.failed)) ? Number(p.failed) : 0,
    lastRunAt: p.lastRunAt || null
  };
}

async function persistProgress(model, id, campaign, patch) {
  const baseMd = (campaign?.metadata && typeof campaign.metadata === "object") ? campaign.metadata : {};
  const baseProg = getProgress(campaign);

  const nextProg = {
    ...baseProg,
    ...patch,
    lastRunAt: new Date().toISOString()
  };

  const nextMd = { ...baseMd, smsProgress: nextProg };

  await model.update({
    where: { id: String(id) },
    data: { metadata: nextMd }
  });

  return nextProg;
}

function renderMessage(template, vars) {
  let text = String(template || "");

  // substitui {{chave}} por vars[chave]
  for (const [k, v] of Object.entries(vars || {})) {
    text = text.replaceAll(`{{${k}}}`, String(v ?? ""));
  }

  return text;
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

    const baseMetadata =
      req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    const item = await model.create({
      data: {
        tenantId,
        channel: "sms",
        name,
        status: STATUS.DRAFT,
        metadata: {
          ...baseMetadata,
          message,
          smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0, lastRunAt: new Date().toISOString() }
        }
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

    // reset progress (a audiência mudou)
    const baseMd = (campaign?.metadata && typeof campaign.metadata === "object") ? campaign.metadata : {};
    const nextMd = {
      ...baseMd,
      smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0, lastRunAt: new Date().toISOString() }
    };

    const item = await model.update({
      where: { id },
      data: { audience, metadata: nextMd }
    });

    return res.json({ ok: true, item, imported: parsed.rows.length, errors: parsed.errors.length });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/audience failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// =========================
// START (envio via IAGENTE) + RESUME exato (cursor)
// =========================
router.post("/:id/start", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const PROGRESS_FLUSH_EVERY = Number(process.env.SMS_PROGRESS_FLUSH_EVERY || 10); // persist a cada N envios
  const STATUS_CHECK_EVERY = Number(process.env.SMS_STATUS_CHECK_EVERY || 10);     // checa pause/cancel a cada N envios

  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const id = String(req.params.id || "");
    const campaign = await getSmsCampaign(model, tenantId, id);
    if (!campaign) return res.status(404).json({ ok: false, error: "not_found" });

    // evita dupla execução
    if (String(campaign.status) === STATUS.RUNNING) {
      return res.status(409).json({ ok: false, error: "already_running" });
    }

    if (!canStart(campaign.status)) {
      return res.status(409).json({ ok: false, error: "invalid_status", status: campaign.status });
    }

    if (!campaign.audience?.rows?.length) {
      return res.status(400).json({ ok: false, error: "audience_required" });
    }

    const messageTemplate = String(campaign.metadata?.message || "").trim();
    if (!messageTemplate) return res.status(400).json({ ok: false, error: "message_required" });

    const env = assertIagenteEnv();
    if (!env.ok) return res.status(500).json({ ok: false, error: env.error });

    // seta RUNNING
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

    // recarrega pra pegar estado atual
    let current = await getSmsCampaign(model, tenantId, id);
    if (!current) return res.status(404).json({ ok: false, error: "not_found" });

    const rows = current.audience.rows;
    let prog = getProgress(current);

    // se cursor passou do total (ex: audiência menor), ajusta
    if (prog.cursor > rows.length) {
      prog = await persistProgress(model, id, current, { cursor: rows.length });
      current = await getSmsCampaign(model, tenantId, id);
    }

    const maxToSend =
      Number(req.query?.limit || 0) > 0 ? Number(req.query.limit) : Number.MAX_SAFE_INTEGER;

    let localSent = 0;
    let localSuccess = 0;
    let localFailed = 0;

    const samples = [];
    const SAMPLE_LIMIT = 50;

    for (let i = prog.cursor; i < rows.length && localSent < maxToSend; i++) {
      // checa pause/cancel periodicamente (no DB)
      if (localSent % STATUS_CHECK_EVERY === 0) {
        const st = await getSmsCampaign(model, tenantId, id);
        const statusNow = String(st?.status || "");
        if (statusNow === STATUS.PAUSED) {
          // persiste cursor atual antes de sair
          await persistProgress(model, id, st, {
            cursor: i,
            sent: prog.sent + localSent,
            success: prog.success + localSuccess,
            failed: prog.failed + localFailed
          });
          return res.status(202).json({ ok: true, paused: true, cursor: i, sent: prog.sent + localSent });
        }
        if (statusNow === STATUS.CANCELED) {
          await persistProgress(model, id, st, {
            cursor: i,
            sent: prog.sent + localSent,
            success: prog.success + localSuccess,
            failed: prog.failed + localFailed
          });
          return res.status(202).json({ ok: true, canceled: true, cursor: i, sent: prog.sent + localSent });
        }
      }

      const row = rows[i];
      const text = renderMessage(messageTemplate, row.vars || {});
      const url = buildIagenteUrl({
        base: env.base,
        user: env.user,
        pass: env.pass,
        phone: row.phone,
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

      localSent++;
      if (ok) localSuccess++;
      else localFailed++;

      if (samples.length < SAMPLE_LIMIT) {
        samples.push({
          i,
          phone: row.phone,
          ok,
          status: statusCode,
          body: String(body || "").slice(0, 500)
        });
      }

      // persiste progresso a cada N envios
      if (localSent % PROGRESS_FLUSH_EVERY === 0) {
        const refreshed = await getSmsCampaign(model, tenantId, id);
        if (!refreshed) break;

        prog = await persistProgress(model, id, refreshed, {
          cursor: i + 1,
          sent: prog.sent + localSent,
          success: prog.success + localSuccess,
          failed: prog.failed + localFailed
        });
        // zera contadores locais (já incorporados em prog)
        localSent = 0;
        localSuccess = 0;
        localFailed = 0;
      }
    }

    // flush final (se sobrou local)
    current = await getSmsCampaign(model, tenantId, id);
    if (!current) return res.status(404).json({ ok: false, error: "not_found" });

    prog = await persistProgress(model, id, current, {
      cursor: Math.min(rows.length, prog.cursor + localSent),
      sent: prog.sent + localSent,
      success: prog.success + localSuccess,
      failed: prog.failed + localFailed
    });

    // terminou tudo? então finaliza
    const done = prog.cursor >= rows.length;

    if (done) {
      await model.update({
        where: { id },
        data: {
          status: STATUS.FINISHED,
          finishedAt: new Date(),
          report: {
            total: prog.sent,
            success: prog.success,
            failed: prog.failed,
            finishedAt: new Date().toISOString(),
            samples
          }
        }
      });

      return res.json({
        ok: true,
        finished: true,
        cursor: prog.cursor,
        totalAudience: rows.length,
        sent: prog.sent,
        success: prog.success,
        failed: prog.failed
      });
    }

    // não terminou (limit usado ou algo parou antes) -> mantém RUNNING (ou o front pode pausar)
    return res.json({
      ok: true,
      finished: false,
      cursor: prog.cursor,
      totalAudience: rows.length,
      sent: prog.sent,
      success: prog.success,
      failed: prog.failed
    });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/start failed");

    // best effort: marca failed
    try {
      const model = resolveModel();
      const tenantId = getTenantId(req);
      const id = String(req.params.id || "");
      if (model && tenantId && id) {
        const current = await getSmsCampaign(model, tenantId, id);
        if (current) {
          await model.update({
            where: { id },
            data: {
              status: STATUS.FAILED,
              finishedAt: new Date(),
              report: { error: String(err?.message || err), failedAt: new Date().toISOString() }
            }
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
// RESUME (só muda status; depois chame POST /start)
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
      data: { status: STATUS.DRAFT, pausedAt: null } // volta pra DRAFT para permitir /start (que aceita DRAFT/PAUSED)
    });

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
