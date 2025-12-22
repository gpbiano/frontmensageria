// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// SMS Campaigns via iAgenteSMS
// Rotas: /outbound/sms-campaigns (ajuste o mount no index.js conforme seu projeto)

import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router();

const IAGENTE_BASE_URL =
  process.env.IAGENTE_SMS_BASE_URL ||
  "https://api.iagentesms.com.br/webservices/http.php";

// ⚠️ NÃO congele USER/PASS em const no topo.
const IAGENTE_HTTP_TIMEOUT_MS = Number(process.env.IAGENTE_HTTP_TIMEOUT_MS || 15000);

// ======================
// FILA / THROTTLE / RETRY
// ======================
const SMS_RATE_PER_SEC = Number(process.env.SMS_RATE_PER_SEC || 5);
const SMS_MAX_RETRIES = Number(process.env.SMS_MAX_RETRIES || 3);
const SMS_RETRY_BASE_MS = Number(process.env.SMS_RETRY_BASE_MS || 800);
const SMS_RETRY_MAX_MS = Number(process.env.SMS_RETRY_MAX_MS || 8000);
const SMS_JITTER_MS = Number(process.env.SMS_JITTER_MS || 250);
const SMS_QUEUE_ENABLED = String(process.env.SMS_QUEUE_ENABLED || "true") !== "false";

const MIN_DELAY_MS = SMS_RATE_PER_SEC > 0 ? Math.ceil(1000 / SMS_RATE_PER_SEC) : 250;

// ======================
// FILA EM MEMÓRIA (por processo)
// ======================
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
    header.indexOf("numero") >= 0 ? header.indexOf("numero") : header.indexOf("phone");

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

// ======================
// TENANT HELPERS
// ======================
function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

async function getCampaignOr404({ tenantId, id }) {
  const camp = await prisma.outboundCampaign.findFirst({
    where: { id: String(id), tenantId, channel: "sms" }
  });
  return camp || null;
}

// ======================
// PROVIDER
// ======================
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
    throw new Error("IAGENTE_SMS_USER/IAGENTE_SMS_PASS não configurados no backend.");
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
      return { ok: false, raw: raw ? `HTTP_${res.status} ${raw}` : `HTTP_${res.status}` };
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
      if (!retry || attempt === maxAttempts) return { ok: false, raw: r.raw, attempt };

      await sleep(jitter(backoffMs(attempt)));
    } catch (err) {
      const msg =
        err?.name === "AbortError"
          ? `Timeout (${IAGENTE_HTTP_TIMEOUT_MS}ms)`
          : err?.message || String(err);

      const retry = shouldRetry({ ok: false, raw: "", error: msg });
      if (!retry || attempt === maxAttempts) return { ok: false, raw: "", error: msg, attempt };

      await sleep(jitter(backoffMs(attempt)));
    }
  }

  return { ok: false, raw: "", attempt: maxAttempts };
}

// ======================
// QUEUE (usa OutboundRun no banco)
// ======================
async function enqueueCampaignRuns({ tenantId, campaignId }) {
  if (!SMS_QUEUE_ENABLED) return { queued: false, added: 0 };

  // audienceRows fica em metadata/audience do OutboundCampaign (Json)
  // Vamos ler do campaign.metadata.audienceRows (compat com seu legado)
  const camp = await prisma.outboundCampaign.findFirst({
    where: { id: campaignId, tenantId, channel: "sms" },
    select: { id: true, metadata: true }
  });
  if (!camp) return { queued: false, added: 0 };

  const md = camp.metadata && typeof camp.metadata === "object" ? camp.metadata : {};
  const audienceRows = Array.isArray(md.audienceRows) ? md.audienceRows : [];

  let added = 0;

  for (const row of audienceRows) {
    const codeSms = String(row?.codeSms || "").trim();
    const phone = String(row?.phone || "").trim();
    const vars = row?.vars && typeof row.vars === "object" ? row.vars : {};

    if (!codeSms || !phone) continue;
    if (smsQueue.enqueuedCodes.has(codeSms)) continue;

    // cria run se não existe
    // usamos externalId = codeSms pra idempotência por campanha
    const existing = await prisma.outboundRun.findFirst({
      where: { tenantId, campaignId, externalId: codeSms }
    });
    if (existing && (existing.status === "sent" || existing.status === "failed")) continue;

    if (!existing) {
      await prisma.outboundRun.create({
        data: {
          tenantId,
          campaignId,
          status: "queued",
          to: phone,
          payload: { vars, codeSms }
        }
      });
    } else if (existing.status !== "queued") {
      await prisma.outboundRun.update({
        where: { id: existing.id },
        data: { status: "queued", payload: { vars, codeSms }, error: null }
      });
    }

    smsQueue.items.push({
      tenantId,
      campaignId,
      phone,
      vars,
      codeSms
    });

    smsQueue.enqueuedCodes.add(codeSms);
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

    const { tenantId, campaignId, phone, vars, codeSms } = job;
    smsQueue.enqueuedCodes.delete(codeSms);

    const camp = await prisma.outboundCampaign.findFirst({
      where: { id: campaignId, tenantId, channel: "sms" }
    });
    if (!camp) return;

    if (camp.status === "paused" || camp.status === "canceled") return;

    // marca como running
    if (camp.status !== "running") {
      await prisma.outboundCampaign.update({
        where: { id: camp.id },
        data: { status: "running" }
      });
    }

    const run = await prisma.outboundRun.findFirst({
      where: { tenantId, campaignId, externalId: codeSms }
    });
    if (run && (run.status === "sent" || run.status === "failed")) return;

    const r = await sendWithRetry({ phone, vars, codeSms, message: camp.name /* placeholder */ });

    // ⚠️ mensagem do SMS vem do metadata.message (compat)
    const md = camp.metadata && typeof camp.metadata === "object" ? camp.metadata : {};
    const message = String(md.message || "");
    const rr = await sendWithRetry({ phone, vars, codeSms, message });

    const status = rr.ok ? "sent" : "failed";
    const providerRaw = String(rr.raw || "");
    const error = String(rr.error || "");

    if (run) {
      await prisma.outboundRun.update({
        where: { id: run.id },
        data: {
          status,
          error: error || null,
          payload: { ...(run.payload || {}), vars, codeSms, providerRaw, attempts: rr.attempt }
        }
      });
    } else {
      await prisma.outboundRun.create({
        data: {
          tenantId,
          campaignId,
          status,
          to: phone,
          externalId: codeSms,
          error: error || null,
          payload: { vars, codeSms, providerRaw, attempts: rr.attempt }
        }
      });
    }

    // atualiza stats agregadas (simples)
    const total = await prisma.outboundRun.count({ where: { tenantId, campaignId } });
    const sent = await prisma.outboundRun.count({ where: { tenantId, campaignId, status: "sent" } });
    const failed = await prisma.outboundRun.count({
      where: { tenantId, campaignId, status: "failed" }
    });

    const finished = total > 0 && sent + failed >= total;

    await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: {
        status: finished ? (failed ? (sent ? "finished" : "failed") : "finished") : "running",
        stats: {
          total,
          sent,
          failed,
          pending: Math.max(0, total - (sent + failed)),
          updatedAt: nowIso()
        }
      }
    });

    await sleep(MIN_DELAY_MS);
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ SMS workerTick erro");
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
router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await prisma.outboundCampaign.findMany({
      where: { tenantId, channel: "sms" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        channel: true,
        name: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        stats: true,
        metadata: true
      }
    });

    return res.json({ ok: true, items });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao listar SMS Campaigns");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// (opcional) DEBUG ENV
router.get("/_debug/env", requireAuth, requireRole(["admin"]), async (_req, res) => {
  return res.json({
    ok: true,
    hasUser: !!process.env.IAGENTE_SMS_USER,
    hasPass: !!process.env.IAGENTE_SMS_PASS,
    baseUrl: process.env.IAGENTE_SMS_BASE_URL || IAGENTE_BASE_URL
  });
});

// CRIAR
router.post("/", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { name, message } = req.body || {};
    if (!name) return res.status(400).json({ ok: false, error: "Informe name." });
    if (!message) return res.status(400).json({ ok: false, error: "Informe message." });

    const item = await prisma.outboundCampaign.create({
      data: {
        tenantId,
        channel: "sms",
        name: String(name).trim(),
        status: "draft",
        stats: { total: 0, sent: 0, failed: 0, pending: 0, updatedAt: nowIso() },
        metadata: {
          message: String(message),
          audienceCount: 0,
          audienceRows: []
        }
      }
    });

    return res.json({ ok: true, item });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao criar SMS Campaign");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// UPLOAD AUDIÊNCIA (CSV TEXT)
router.post("/:id/audience", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const { csvText } = req.body || {};

    if (!csvText || !String(csvText).trim()) {
      return res.status(400).json({ ok: false, error: "Envie csvText (texto do CSV)." });
    }

    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    const rows = parseCsvToRows(csvText);

    const stamp = Date.now();
    const audienceRows = rows.map((r, idx) => ({
      ...r,
      codeSms: `sms_${camp.id}_${stamp}_${idx}`
    }));

    const md = camp.metadata && typeof camp.metadata === "object" ? camp.metadata : {};

    const updated = await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: {
        status: audienceRows.length ? "ready" : "draft",
        metadata: {
          ...md,
          audienceRows,
          audienceCount: audienceRows.length
        },
        stats: {
          total: audienceRows.length,
          sent: 0,
          failed: 0,
          pending: audienceRows.length,
          updatedAt: nowIso()
        }
      }
    });

    return res.json({ ok: true, audienceCount: updated?.metadata?.audienceCount || audienceRows.length });
  } catch (e) {
    logger.warn({ err: e?.message || e }, "⚠️ Erro ao importar audiência SMS");
    return res.status(400).json({ ok: false, error: e?.message || "Erro ao importar CSV." });
  }
});

// START
router.post("/:id/start", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    const md = camp.metadata && typeof camp.metadata === "object" ? camp.metadata : {};
    const audienceRows = Array.isArray(md.audienceRows) ? md.audienceRows : [];

    if (!audienceRows.length) {
      return res.status(400).json({ ok: false, error: "Campanha sem audiência." });
    }

    await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: { status: "running" }
    });

    const { queued, added } = await enqueueCampaignRuns({ tenantId, campaignId: camp.id });
    ensureWorker();

    const sent = await prisma.outboundRun.count({ where: { tenantId, campaignId: camp.id, status: "sent" } });
    const failed = await prisma.outboundRun.count({ where: { tenantId, campaignId: camp.id, status: "failed" } });

    return res.json({ ok: true, queued, added, sent, failed, status: "running" });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao iniciar SMS Campaign");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// PAUSE
router.post("/:id/pause", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    const updated = await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: { status: "paused" }
    });

    return res.json({ ok: true, status: updated.status });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao pausar SMS Campaign");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// RESUME
router.post("/:id/resume", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: { status: "running" }
    });

    const { queued, added } = await enqueueCampaignRuns({ tenantId, campaignId: camp.id });
    ensureWorker();

    return res.json({ ok: true, queued, added, status: "running" });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao retomar SMS Campaign");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// CANCEL
router.post("/:id/cancel", requireAuth, requireRole(["admin", "manager"]), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    const updated = await prisma.outboundCampaign.update({
      where: { id: camp.id },
      data: { status: "canceled" }
    });

    return res.json({ ok: true, status: updated.status });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao cancelar SMS Campaign");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// REPORT (JSON)
router.get("/:id/report", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

    const total = await prisma.outboundRun.count({ where: { tenantId, campaignId: camp.id } });
    const results = await prisma.outboundRun.findMany({
      where: { tenantId, campaignId: camp.id },
      orderBy: { createdAt: "asc" },
      select: { to: true, status: true, externalId: true, payload: true, error: true, updatedAt: true }
    });

    const sent = results.filter((r) => r.status === "sent").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const pending = Math.max(0, total - (sent + failed));

    return res.json({
      ok: true,
      id: camp.id,
      name: camp.name,
      status: camp.status,
      total,
      sent,
      failed,
      pending,
      results: results.map((r) => ({
        phone: r.to,
        status: r.status,
        codeSms: r.externalId || "",
        attempts: r?.payload?.attempts ?? "",
        providerRaw: r?.payload?.providerRaw ?? "",
        error: r.error || "",
        updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : nowIso()
      }))
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao gerar report SMS");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// DOWNLOAD REPORT CSV
router.get("/:id/report.csv", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).send("tenant_not_resolved");

    const { id } = req.params;
    const camp = await getCampaignOr404({ tenantId, id });
    if (!camp) return res.status(404).send("Campanha não encontrada");

    const rows = await prisma.outboundRun.findMany({
      where: { tenantId, campaignId: camp.id },
      orderBy: { createdAt: "asc" },
      select: { to: true, status: true, externalId: true, payload: true, error: true, updatedAt: true }
    });

    const header = ["telefone", "status", "codeSms", "tentativas", "retorno_iagente", "erro", "atualizado_em"];

    const csv = [
      header.join(";"),
      ...rows.map((r) =>
        [
          r.to,
          r.status,
          r.externalId || "",
          r?.payload?.attempts ?? "",
          `"${String(r?.payload?.providerRaw || "").replace(/"/g, '""')}"`,
          `"${String(r.error || "").replace(/"/g, '""')}"`,
          r.updatedAt ? new Date(r.updatedAt).toISOString() : ""
        ].join(";")
      )
    ].join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="sms-report-${camp.id}.csv"`);
    return res.send(csv);
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ Erro ao exportar CSV SMS");
    return res.status(500).send("Erro ao exportar CSV");
  }
});

export default router;
