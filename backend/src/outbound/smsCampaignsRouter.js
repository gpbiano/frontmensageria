// backend/src/outbound/smsCampaignsRouter.js
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
// Feature flag
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

function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return true;
  }
}

function getTenantId(req) {
  return String(req.tenant?.id || req.tenantId || req.user?.tenantId || "");
}

function assertPrisma(res, model) {
  if (!prisma || !model) {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  return true;
}

async function getCampaign(model, tenantId, id) {
  return model.findFirst({
    where: { id: String(id), tenantId, channel: "sms" }
  });
}

// =========================
// Provider env
// =========================
function assertProviderEnv() {
  const user = process.env.IAGENTE_SMS_USER;
  const pass = process.env.IAGENTE_SMS_PASS;
  const base = process.env.IAGENTE_SMS_BASE_URL;
  if (!user || !pass || !base) return { ok: false };
  return { ok: true, user, pass, base };
}

function buildProviderUrl({ base, user, pass, phone, message }) {
  const u = new URL(base);
  u.searchParams.set("usuario", user);
  u.searchParams.set("senha", pass);
  u.searchParams.set("celular", phone);
  u.searchParams.set("mensagem", message);
  return u.toString();
}

// =========================
// CSV helpers
// =========================
function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 10 ? d : null;
}

function detectDelimiter(text) {
  const s = text.split(/\r?\n/).slice(0, 5).join("\n");
  return (s.match(/;/g) || []).length > (s.match(/,/g) || []).length ? ";" : ",";
}

function parseCsv(text) {
  const rows = [];
  const errors = [];

  const clean = text.replace(/^\uFEFF/, "");
  const delim = detectDelimiter(clean);
  const lines = clean.split(/\r?\n/).filter(Boolean);

  if (!lines.length) return { rows, errors };

  const header = lines[0].split(delim).map((h) => h.trim().toLowerCase());
  const phoneIdx = header.findIndex((h) => ["numero", "phone", "telefone"].includes(h));

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(delim).map((c) => c.trim());
    const phone = normalizePhone(cols[phoneIdx]);

    if (!phone) {
      errors.push({ line: i + 1, error: "invalid_phone" });
      continue;
    }

    const vars = {};
    header.forEach((h, idx) => {
      if (idx !== phoneIdx) vars[h] = cols[idx] || "";
    });

    rows.push({ phone, vars });
  }

  return { rows, errors };
}

// =========================
// Status
// =========================
const STATUS = {
  DRAFT: "draft",
  RUNNING: "running",
  PAUSED: "paused",
  CANCELED: "canceled",
  FINISHED: "finished",
  FAILED: "failed"
};

const canStart = (s) => [STATUS.DRAFT, STATUS.PAUSED].includes(s);
const canPause = (s) => s === STATUS.RUNNING;
const canResume = (s) => s === STATUS.PAUSED;
const canCancel = (s) => [STATUS.DRAFT, STATUS.RUNNING, STATUS.PAUSED].includes(s);
const canDelete = (s) => s === STATUS.DRAFT;

// =========================
// GET
// =========================
router.get("/", requireAuth, async (req, res) => {
  if (!isSmsEnabled()) return res.status(403).json({ ok: false });

  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const tenantId = getTenantId(req);
  const items = await model.findMany({
    where: { tenantId, channel: "sms" },
    orderBy: { createdAt: "desc" }
  });

  res.json({ ok: true, items });
});

// =========================
// CREATE
// =========================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const { name, message } = req.body;
  if (!name || !message) return res.status(400).json({ ok: false });

  const item = await model.create({
    data: {
      tenantId: getTenantId(req),
      channel: "sms",
      name,
      message,
      status: STATUS.DRAFT,
      metadata: {
        message,
        smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0 }
      }
    }
  });

  res.status(201).json({ ok: true, item });
});

// =========================
// UPLOAD AUDIENCE
// =========================
router.post("/:id/audience", requireAuth, requireRole("admin", "manager"), upload.single("file"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const csv = req.file?.buffer?.toString("utf8");
  if (!csv) return res.status(400).json({ ok: false, error: "csv_required" });

  const parsed = parseCsv(csv);
  if (!parsed.rows.length) return res.status(400).json({ ok: false });

  const item = await model.update({
    where: { id: req.params.id },
    data: {
      audience: { rows: parsed.rows },
      metadata: {
        smsProgress: { cursor: 0, sent: 0, success: 0, failed: 0 }
      }
    }
  });

  res.json({ ok: true, item, imported: parsed.rows.length });
});

// =========================
// START / RESUME
// =========================
router.post("/:id/start", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const campaign = await getCampaign(model, getTenantId(req), req.params.id);
  if (!campaign || !canStart(campaign.status)) {
    return res.status(409).json({ ok: false });
  }

  const env = assertProviderEnv();
  if (!env.ok) return res.status(500).json({ ok: false });

  await model.update({
    where: { id: campaign.id },
    data: { status: STATUS.RUNNING }
  });

  res.json({ ok: true, started: true });
});

// =========================
// PAUSE
// =========================
router.patch("/:id/pause", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const c = await getCampaign(model, getTenantId(req), req.params.id);
  if (!c || !canPause(c.status)) return res.status(409).json({ ok: false });

  const item = await model.update({
    where: { id: c.id },
    data: { status: STATUS.PAUSED }
  });

  res.json({ ok: true, item });
});

// =========================
// RESUME
// =========================
router.patch("/:id/resume", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const c = await getCampaign(model, getTenantId(req), req.params.id);
  if (!c || !canResume(c.status)) return res.status(409).json({ ok: false });

  const item = await model.update({
    where: { id: c.id },
    data: { status: STATUS.DRAFT }
  });

  res.json({ ok: true, item });
});

// =========================
// CANCEL
// =========================
router.patch("/:id/cancel", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const c = await getCampaign(model, getTenantId(req), req.params.id);
  if (!c || !canCancel(c.status)) return res.status(409).json({ ok: false });

  const item = await model.update({
    where: { id: c.id },
    data: { status: STATUS.CANCELED }
  });

  res.json({ ok: true, item });
});

// =========================
// DELETE (ONLY DRAFT)
// =========================
router.delete("/:id", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel();
  if (!assertPrisma(res, model)) return;

  const c = await getCampaign(model, getTenantId(req), req.params.id);
  if (!c || !canDelete(c.status)) {
    return res.status(409).json({ ok: false, error: "cannot_delete_status" });
  }

  await model.delete({ where: { id: c.id } });
  res.json({ ok: true });
});

export default router;
