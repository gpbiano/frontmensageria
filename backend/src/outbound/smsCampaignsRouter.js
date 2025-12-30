// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns

import express from "express";
import multer from "multer";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

// Upload (CSV)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

/* =========================
 * Helpers (Prisma-safe)
 * ========================= */
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
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expectedAnyOf: candidates }
    });
    return false;
  }
  return true;
}

/* =========================
 * CSV parsing (SMS audience)
 * - aceita separador , ou ;
 * - header opcional: numero (ou phone), var_1, var_2...
 * - linhas vazias/invalidas viram errors
 * ========================= */
function normalizePhone(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/[^\d+]/g, "");

  // remove leading +
  const digits = s.startsWith("+") ? s.slice(1) : s;

  // muito curto -> inválido
  if (digits.length < 10) return null;

  // se já veio com 55 + DDD + número, mantém
  // se veio sem 55 mas com DDD/número, você pode decidir forçar 55 (aqui NÃO forçamos)
  return digits;
}

function detectDelimiter(text) {
  const sample = String(text || "").split(/\r?\n/).slice(0, 5).join("\n");
  const commas = (sample.match(/,/g) || []).length;
  const semis = (sample.match(/;/g) || []).length;
  return semis > commas ? ";" : ",";
}

function parseCsvPhones(csvText) {
  const text = String(csvText || "").replace(/^\uFEFF/, ""); // remove BOM
  const delim = detectDelimiter(text);

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out = { rows: [], errors: [] };
  if (!lines.length) return out;

  // header?
  const firstCols = lines[0].split(delim).map((c) => c.trim());
  const firstLower = firstCols.map((c) => c.toLowerCase());

  const hasHeader =
    firstLower.includes("numero") ||
    firstLower.includes("phone") ||
    firstLower.includes("telefone");

  let startIdx = 0;
  let phoneIdx = 0;
  let varIdxs = [];

  if (hasHeader) {
    startIdx = 1;
    phoneIdx =
      firstLower.indexOf("numero") !== -1
        ? firstLower.indexOf("numero")
        : firstLower.indexOf("phone") !== -1
          ? firstLower.indexOf("phone")
          : firstLower.indexOf("telefone");

    // var_1, var_2... (ou qualquer coluna além do numero)
    varIdxs = firstCols
      .map((_, i) => i)
      .filter((i) => i !== phoneIdx);
  } else {
    // sem header: primeira coluna é número, resto variáveis
    phoneIdx = 0;
    varIdxs = firstCols.map((_, i) => i).filter((i) => i !== 0);
  }

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const cols = rawLine.split(delim).map((c) => c.trim());

    const rawPhone = cols[phoneIdx];
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      out.errors.push({ line: i + 1, error: "invalid_phone", value: rawPhone || "" });
      continue;
    }

    const vars = {};
    for (const idx of varIdxs) {
      const key =
        hasHeader && firstCols[idx]
          ? String(firstCols[idx]).trim()
          : `var_${idx}`; // fallback se sem header

      if (!key) continue;
      vars[key] = cols[idx] !== undefined ? String(cols[idx]) : "";
    }

    out.rows.push({ phone, vars });
  }

  return out;
}

/* =========================
 * Model resolution
 * ========================= */
// OBS: reaproveita OutboundCampaign para SMS também (channel="sms")
const MODEL_CANDIDATES = ["outboundCampaign", "OutboundCampaign", "campaign", "Campaign"];
const PRISMA_MODEL_NAME = "OutboundCampaign";

/* ======================================================
 * GET /outbound/sms-campaigns
 * ====================================================== */
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = PRISMA_MODEL_NAME;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    // SMS -> channel="sms"
    if (modelHasField(modelName, "channel")) where.channel = "sms";

    const items = await model.findMany({
      where,
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ======================================================
 * POST /outbound/sms-campaigns (create)
 * body: { name, message, metadata? }
 * ====================================================== */
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = PRISMA_MODEL_NAME;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });

    const data = {};

    // ✅ IMPORTANTÍSSIMO: channel e name são REQUIRED no schema
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) data.channel = "sms";
    if (modelHasField(modelName, "name")) data.name = name;

    if (modelHasField(modelName, "status")) data.status = "draft";
    if (modelHasField(modelName, "metadata")) data.metadata = { ...metadata, message };

    const item = await model.create({ data });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ======================================================
 * POST /outbound/sms-campaigns/:id/audience (CSV)
 * Aceita:
 * - multipart/form-data (file)
 * - text/csv (raw)
 * - application/json { csv }
 * ====================================================== */
router.post(
  "/:id/audience",
  requireAuth,
  requireRole("admin", "manager"),
  upload.single("file"),
  async (req, res) => {
    const model = resolveModel(MODEL_CANDIDATES);
    const modelName = PRISMA_MODEL_NAME;

    try {
      if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

      const id = String(req.params.id || "");

      const existing = await model.findFirst({
        where: {
          id,
          ...(modelHasField(modelName, "tenantId") ? { tenantId } : {}),
          ...(modelHasField(modelName, "channel") ? { channel: "sms" } : {})
        },
        select: { id: true }
      });

      if (!existing) return res.status(404).json({ ok: false, error: "not_found" });

      let csvText = "";

      // ✅ multipart/form-data
      if (req.file?.buffer) {
        csvText = req.file.buffer.toString("utf-8");
      }
      // ✅ raw text/csv
      else if (typeof req.body === "string" && req.body.trim()) {
        csvText = req.body;
      }
      // ✅ JSON { csv }
      else if (typeof req.body?.csv === "string") {
        csvText = req.body.csv;
      }

      if (!csvText.trim()) return res.status(400).json({ ok: false, error: "csv_required" });

      const parsed = parseCsvPhones(csvText);

      if (!parsed.rows.length) {
        return res.status(400).json({
          ok: false,
          error: "csv_empty_or_invalid",
          details: parsed.errors
        });
      }

      const audience = {
        rows: parsed.rows,
        total: parsed.rows.length,
        errors: parsed.errors,
        importedAt: new Date().toISOString()
      };

      const data = {};
      if (modelHasField(modelName, "audience")) data.audience = audience;

      const item = await model.update({ where: { id }, data });

      return res.json({
        ok: true,
        item,
        audienceSummary: { total: audience.total, errors: audience.errors.length }
      });
    } catch (err) {
      logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter POST /:id/audience failed");
      return res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);

export default router;
