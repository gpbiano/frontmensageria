// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/sms-campaigns
//
// Este router usa o model OutboundCampaign com channel="sms" para campanhas de SMS.
// Fluxo:
// 1) POST   /outbound/sms-campaigns           -> cria campanha (draft)
// 2) POST   /outbound/sms-campaigns/:id/audience (CSV) -> importa audiência (audience Json)
// 3) (futuro) POST /outbound/sms-campaigns/:id/start   -> dispara via IAGENTE

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
 * Feature Flag (Add-on SMS)
 * =========================
 * - Se quiser controlar por tenant no futuro, aqui é o ponto.
 * - Por enquanto, gate global por ENV:
 *    SMS_ENABLED=true
 */
function isSmsEnabled() {
  const v = String(process.env.SMS_ENABLED || "").trim().toLowerCase();
  // default: enabled (para não quebrar ambiente existente)
  if (!v) return true;
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

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
    // se não conseguir ler dmmf, assume true (safe fallback)
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
 * - header opcional: numero (ou phone/telefone), var_1, var_2...
 * - linhas vazias/invalidas viram errors
 * ========================= */
function normalizePhone(raw) {
  const s = String(raw || "")
    .trim()
    .replace(/[^\d+]/g, "");

  const digits = s.startsWith("+") ? s.slice(1) : s;

  // muito curto -> inválido
  if (digits.length < 10) return null;

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
  let varHeaders = [];

  if (hasHeader) {
    startIdx = 1;

    phoneIdx =
      firstLower.indexOf("numero") !== -1
        ? firstLower.indexOf("numero")
        : firstLower.indexOf("phone") !== -1
          ? firstLower.indexOf("phone")
          : firstLower.indexOf("telefone");

    varIdxs = firstCols.map((_, i) => i).filter((i) => i !== phoneIdx);
    varHeaders = firstCols;
  } else {
    phoneIdx = 0;
    varIdxs = firstCols.map((_, i) => i).filter((i) => i !== 0);
    varHeaders = []; // sem header
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
      const headerName = hasHeader ? String(varHeaders[idx] || "").trim() : "";

      // ✅ se não tem header, usamos var_1, var_2... (baseado na ordem, não no índice bruto)
      const fallbackKey = `var_${varIdxs.indexOf(idx) + 1}`;
      const key = headerName || fallbackKey;

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
    if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
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
 *
 * ✅ FIX DEFINITIVO:
 * - channel e name são REQUIRED no schema -> setamos SEMPRE
 * - tenantId também é REQUIRED no teu schema -> setamos SEMPRE
 * ====================================================== */
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = PRISMA_MODEL_NAME;

  try {
    if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const metadata = req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });

    // ✅ Campos obrigatórios: SEMPRE SETAR
    const data = {
      tenantId,
      channel: "sms",
      name
    };

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
 *
 * ⚠️ IMPORTANTE:
 * - pra multipart, o client precisa enviar:
 *   field name: "file"
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
      if (!isSmsEnabled()) return res.status(403).json({ ok: false, error: "sms_not_enabled" });
      if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ ok: false, error: "id_required" });

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
      // ✅ raw text/csv (se algum middleware de body estiver entregando como string)
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

      // ✅ opcional: manter status como "draft" (não muda aqui)
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
