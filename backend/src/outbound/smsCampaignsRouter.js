// backend/src/outbound/smsCampaignsRouter.js
import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

const IAGENTE_BASE_URL =
  process.env.IAGENTE_SMS_BASE_URL ||
  "https://api.iagentesms.com.br/webservices/http.php";

// ⚠️ NÃO congele USER/PASS em const no topo.
// Em dev (nodemon/pm2), isso pode ficar “stale” se o env não estiver carregado no momento do import.
// Vamos ler sempre de process.env no momento do envio.
const IAGENTE_HTTP_TIMEOUT_MS = Number(
  process.env.IAGENTE_HTTP_TIMEOUT_MS || 15000
);

// ======================
// FILA / THROTTLE / RETRY
// ======================
const SMS_RATE_PER_SEC = Number(process.env.SMS_RATE_PER_SEC || 5);
const SMS_MAX_RETRIES = Number(process.env.SMS_MAX_RETRIES || 3);
const SMS_RETRY_BASE_MS = Number(process.env.SMS_RETRY_BASE_MS || 800);
const SMS_RETRY_MAX_MS = Number(process.env.SMS_RETRY_MAX_MS || 8000);
const SMS_JITTER_MS = Number(process.env.SMS_JITTER_MS || 250);
const SMS_QUEUE_ENABLED =
  String(process.env.SMS_QUEUE_ENABLED || "true") !== "false";

const MIN_DELAY_MS =
  SMS_RATE_PER_SEC > 0 ? Math.ceil(1000 / SMS_RATE_PER_SEC) : 250;

// Fila em memória
const smsQueue = {
  running: false,
  timer: null,
  items: [],
  enqueuedCodes: new Set()
};

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "smscamp") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(ms) {
  const j = Math.floor(Math.random() * SMS_JITTER_MS);
  return ms + j;
}

function backoffMs(attempt) {
  const raw = SMS_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(raw, SMS_RETRY_MAX_MS);
}

/**
 * Normaliza telefone para padrão BR:
 * 55 + DDD(2) + número(8|9) => 12 ou 13 dígitos.
 */
function normalizePhoneBR(raw) {
  if (!raw) return "";

  let digits = String(raw).replace(/\D/g, "");

  if (digits.startsWith("00")) digits = digits.slice(2);

  // remove repetições no início (casos bizarros)
  while (digits.startsWith("5555")) digits = digits.slice(2);

  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) {
    return digits;
  }

  if (!digits.startsWith("55")) digits = `55${digits}`;

  if (digits.length < 12 || digits.length > 13) return "";

  return digits;
}

function parseCsvToRows(csvText) {
  const text = (csvText || "").trim();
  if (!text) return [];

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (!lines.length) return [];

  const guessSep = lines[0].includes(";") ? ";" : ",";
  const header = lines[0]
    .split(guessSep)
    .map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const idxNumero =
    header.indexOf("numero") >= 0
      ? header.indexOf("numero")
      : header.indexOf("phone");

  if (idxNumero < 0) {
    throw new Error("CSV precisa conter coluna 'numero' (ou 'phone').");
  }

  const varIndexes = header
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => /^var_\d+$/.test(h));

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i]
      .split(guessSep)
      .map((c) => c.trim().replace(/^"|"$/g, ""));

    const phone = normalizePhoneBR(cols[idxNumero]);
    if (!phone) continue;

    const vars = {};
    for (const { h, i: colIdx } of varIndexes) {
      vars[h] = cols[colIdx] ?? "";
    }

    rows.push({ phone, vars });
  }

  return rows;
}

function applyVars(message, vars) {
  let out = String(message || "");
  if (!vars) return out;

  out = out.replace(/\{\{\s*(\d+)\s*\}\}/g, (_m, n) => {
    const key = `var_${n}`;
    return vars[key] ?? "";
  });

  out = out.replace(/\{\{\s*(var_\d+)\s*\}\}/g, (_m, key) => {
    return vars[key] ?? "";
  });

  return out;
}

function getCampaign(db, id) {
  db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);
  return db.outboundSmsCampaigns.find((c) => c.id === id);
}

function buildResultsIndex(camp) {
  const idx = new Map();
  for (const r of ensureArray(camp.results)) {
    if (r?.codeSms) idx.set(r.codeSms, r);
  }
  return idx;
}

function shouldRetry({ ok, raw, error }) {
  if (ok) return false;
  if (error) return true;

  const txt = String(raw || "").toLowerCase();

  if (txt.includes("usuario") && txt.includes("senha")) return false;
  if (txt.includes("inval")) return false;
  if (txt.includes("bloque")) return false;
  if (txt.includes("saldo")) return false;

  if (txt.startsWith("erro")) return true;

  return true;
}

async function iagenteSendSms({ to, text, codeSms }) {
  const user = process.env.IAGENTE_SMS_USER;
  const pass = process.env.IAGENTE_SMS_PASS;

  if (!user || !pass) {
    // mensagem clara pro front/relatório
    throw new Error(
      "IAGENTE_SMS_USER/IAGENTE_SMS_PASS não configurados no backend (env não carregou)."
    );
  }

  const params = new URLSearchParams();
  params.set("metodo", "envio");
  params.set("usuario", user);
  params.set("senha", pass);
  params.set("celular", to);
  params.set("mensagem", text);
  if (codeSms) params.set("codigosms", codeSms);

  const url = `${IAGENTE_BASE_URL}?${params.toString()}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), IAGENTE_HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal });
    const bodyText = await res.text();
    const raw = (bodyText || "").trim();

    if (!res.ok) {
      return {
        ok: false,
        raw: raw ? `HTTP_${res.status} ${raw}` : `HTTP_${res.status}`
      };
    }

    const ok = /^OK/i.test(raw);
    return { ok, raw };
  } finally {
    clearTimeout(t);
  }
}

async function sendWithRetry({ phone, vars, codeSms, message }) {
  const maxAttempts = 1 + SMS_MAX_RETRIES;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const text = applyVars(message, vars);
      const r = await iagenteSendSms({ to: phone, text, codeSms });

      if (r.ok) return { ok: true, raw: r.raw, attempt };

      const retry = shouldRetry({ ok: false, raw: r.raw, error: null });
      if (!retry || attempt === maxAttempts) {
        return { ok: false, raw: r.raw, attempt };
      }

      await sleep(jitter(backoffMs(attempt)));
    } catch (err) {
      const msg =
        err?.name === "AbortError"
          ? `Timeout (${IAGENTE_HTTP_TIMEOUT_MS}ms)`
          : err?.message || String(err);

      const retry = shouldRetry({ ok: false, raw: "", error: msg });

      if (!retry || attempt === maxAttempts) {
        return { ok: false, raw: "", error: msg, attempt };
      }

      await sleep(jitter(backoffMs(attempt)));
    }
  }

  return { ok: false, raw: "", attempt: maxAttempts };
}

function enqueueCampaign(camp) {
  if (!SMS_QUEUE_ENABLED) return { queued: false, added: 0 };

  const resultsIdx = buildResultsIndex(camp);
  let added = 0;

  for (const row of ensureArray(camp.audienceRows)) {
    const code = row.codeSms;
    if (!code) continue;

    const existing = resultsIdx.get(code);
    if (existing && (existing.status === "sent" || existing.status === "failed"))
      continue;

    if (smsQueue.enqueuedCodes.has(code)) continue;

    smsQueue.items.push({
      campaignId: camp.id,
      phone: row.phone,
      vars: row.vars || {},
      codeSms: code
    });

    smsQueue.enqueuedCodes.add(code);
    added++;
  }

  return { queued: true, added };
}

async function workerTick() {
  if (smsQueue.running) return;
  smsQueue.running = true;

  try {
    const job = smsQueue.items.shift();
    if (!job) return;

    const { campaignId, phone, vars, codeSms } = job;

    smsQueue.enqueuedCodes.delete(codeSms);

    const db = loadDB();
    const camp = getCampaign(db, campaignId);
    if (!camp) return;

    if (camp.status === "paused" || camp.status === "canceled") return;

    camp.results = ensureArray(camp.results);
    const idx = buildResultsIndex(camp);

    const existing = idx.get(codeSms);
    if (existing && (existing.status === "sent" || existing.status === "failed"))
      return;

    camp.status = "running";
    camp.updatedAt = nowIso();
    saveDB(db);

    const r = await sendWithRetry({
      phone,
      vars,
      codeSms,
      message: camp.message
    });

    const resultRow = {
      phone,
      codeSms,
      status: r.ok ? "sent" : "failed",
      providerRaw: String(r.raw || ""),
      error: String(r.error || ""),
      attempts: r.attempt,
      updatedAt: nowIso()
    };

    const pos = camp.results.findIndex((x) => x.codeSms === codeSms);
    if (pos >= 0) camp.results[pos] = { ...camp.results[pos], ...resultRow };
    else camp.results.push(resultRow);

    camp.updatedAt = nowIso();

    const total =
      camp.audienceCount || ensureArray(camp.audienceRows).length || 0;
    const sent = camp.results.filter((x) => x.status === "sent").length;
    const failed = camp.results.filter((x) => x.status === "failed").length;

    if (total > 0 && sent + failed >= total) {
      camp.status = failed ? (sent ? "finished" : "failed") : "finished";
    } else {
      camp.status = "running";
    }

    saveDB(db);

    await sleep(MIN_DELAY_MS);
  } catch (e) {
    logger.error({ err: e }, "❌ SMS workerTick erro");
  } finally {
    smsQueue.running = false;
  }
}

function ensureWorker() {
  if (!SMS_QUEUE_ENABLED) return;
  if (smsQueue.timer) return;

  smsQueue.timer = setInterval(() => {
    workerTick();
  }, 50);

  if (typeof smsQueue.timer?.unref === "function") smsQueue.timer.unref();
}

ensureWorker();

// ======================
// ROTAS
// ======================

// LISTAR
router.get("/", requireAuth, async (_req, res) => {
  const db = loadDB();
  db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

  const list = [...db.outboundSmsCampaigns].sort((a, b) =>
    String(b.createdAt).localeCompare(String(a.createdAt))
  );

  res.json({ ok: true, items: list });
});

// (opcional) DEBUG ENV - útil pra você validar em prod/dev (remova depois)
router.get("/_debug/env", requireAuth, requireRole(["admin"]), async (_req, res) => {
  res.json({
    ok: true,
    hasUser: !!process.env.IAGENTE_SMS_USER,
    hasPass: !!process.env.IAGENTE_SMS_PASS,
    baseUrl: process.env.IAGENTE_SMS_BASE_URL || IAGENTE_BASE_URL
  });
});

// CRIAR
router.post("/", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const { name, message } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "Informe name." });
    if (!message) return res.status(400).json({ ok: false, error: "Informe message." });

    const db = loadDB();
    db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

    const item = {
      id: newId(),
      name: String(name).trim(),
      message: String(message),
      status: "draft",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      audienceCount: 0,
      audienceRows: [],
      results: []
    };

    db.outboundSmsCampaigns.push(item);
    saveDB(db);

    res.json({ ok: true, item });
  } catch (e) {
    logger.error({ err: e }, "❌ Erro ao criar SMS Campaign");
    res.status(500).json({ ok: false, error: "Erro interno ao criar campanha SMS." });
  }
});

// UPLOAD AUDIÊNCIA (CSV TEXT)
router.post(
  "/:id/audience",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { csvText } = req.body || {};

      if (!csvText || !String(csvText).trim()) {
        return res.status(400).json({ ok: false, error: "Envie csvText (texto do CSV)." });
      }

      const db = loadDB();
      const camp = getCampaign(db, id);
      if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

      const rows = parseCsvToRows(csvText);

      const stamp = Date.now();
      camp.audienceRows = rows.map((r, idx) => ({
        ...r,
        codeSms: `sms_${id}_${stamp}_${idx}`
      }));

      camp.audienceCount = camp.audienceRows.length;
      camp.status = camp.audienceCount ? "ready" : "draft";
      camp.updatedAt = nowIso();

      camp.results = [];
      saveDB(db);

      res.json({ ok: true, audienceCount: camp.audienceCount });
    } catch (e) {
      logger.warn({ err: e }, "⚠️ Erro ao importar audiência SMS");
      res.status(400).json({ ok: false, error: e.message || "Erro ao importar CSV." });
    }
  }
);

// START
router.post(
  "/:id/start",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const db = loadDB();
      const camp = getCampaign(db, id);
      if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

      if (!ensureArray(camp.audienceRows).length) {
        return res.status(400).json({ ok: false, error: "Campanha sem audiência." });
      }

      camp.status = "running";
      camp.updatedAt = nowIso();
      camp.results = ensureArray(camp.results);
      saveDB(db);

      const { queued, added } = enqueueCampaign(camp);
      ensureWorker();

      res.json({
        ok: true,
        queued,
        added,
        sent: camp.results.filter((x) => x.status === "sent").length,
        failed: camp.results.filter((x) => x.status === "failed").length,
        status: camp.status
      });
    } catch (e) {
      logger.error({ err: e }, "❌ Erro ao iniciar SMS Campaign");
      res.status(500).json({ ok: false, error: "Erro interno ao iniciar campanha SMS." });
    }
  }
);

// PAUSE
router.post(
  "/:id/pause",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    const { id } = req.params;
    const db = loadDB();
    const camp = getCampaign(db, id);
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    camp.status = "paused";
    camp.updatedAt = nowIso();
    saveDB(db);

    res.json({ ok: true, status: camp.status });
  }
);

// RESUME
router.post(
  "/:id/resume",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    const { id } = req.params;
    const db = loadDB();
    const camp = getCampaign(db, id);
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    camp.status = "running";
    camp.updatedAt = nowIso();
    saveDB(db);

    const { queued, added } = enqueueCampaign(camp);
    ensureWorker();

    res.json({ ok: true, queued, added, status: camp.status });
  }
);

// CANCEL
router.post(
  "/:id/cancel",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    const { id } = req.params;
    const db = loadDB();
    const camp = getCampaign(db, id);
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    camp.status = "canceled";
    camp.updatedAt = nowIso();
    saveDB(db);

    res.json({ ok: true, status: camp.status });
  }
);

// REPORT (JSON)
router.get("/:id/report", requireAuth, async (req, res) => {
  const { id } = req.params;

  const db = loadDB();
  const camp = getCampaign(db, id);
  if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

  const total =
    camp.audienceCount || ensureArray(camp.audienceRows).length || 0;
  const results = ensureArray(camp.results);

  const sent = results.filter((r) => r.status === "sent").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const pending = Math.max(0, total - (sent + failed));

  res.json({
    ok: true,
    id: camp.id,
    name: camp.name,
    status: camp.status,
    total,
    sent,
    failed,
    pending,
    results
  });
});

// DOWNLOAD REPORT CSV (Excel)
router.get("/:id/report.csv", requireAuth, async (req, res) => {
  const { id } = req.params;

  const db = loadDB();
  const camp = getCampaign(db, id);
  if (!camp) return res.status(404).send("Campanha não encontrada");

  const rows = ensureArray(camp.results);

  const header = ["telefone", "status", "tentativas", "retorno_iagente", "erro", "atualizado_em"];

  const csv = [
    header.join(";"),
    ...rows.map((r) =>
      [
        r.phone,
        r.status,
        r.attempts,
        `"${String(r.providerRaw || "").replace(/"/g, '""')}"`,
        `"${String(r.error || "").replace(/"/g, '""')}"`,
        r.updatedAt
      ].join(";")
    )
  ].join("\n");

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sms-report-${camp.id}.csv"`);

  res.send(csv);
});

export default router;
