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

const IAGENTE_USER = process.env.IAGENTE_SMS_USER;
const IAGENTE_PASS = process.env.IAGENTE_SMS_PASS;

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "smscamp") {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizePhoneBR(raw) {
  if (!raw) return "";
  // Mantém só dígitos
  const digits = String(raw).replace(/\D/g, "");
  // Se já vier com 55, mantém; se vier só DDD+numero, prefixa 55
  if (digits.startsWith("55")) return digits;
  // Evita "00" etc.
  if (digits.length >= 10) return `55${digits}`;
  return digits;
}

function parseCsvToRows(csvText) {
  // Aceita separador ";" ou ",".
  // Espera header contendo "numero" (ou "phone") e opcionalmente var_1, var_2...
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
  // Suporta {{var_1}} ou {{1}} (converte {{1}} => var_1)
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

async function iagenteSendSms({ to, text, codeSms }) {
  if (!IAGENTE_USER || !IAGENTE_PASS) {
    throw new Error("IAGENTE_SMS_USER/IAGENTE_SMS_PASS não configurados.");
  }

  const params = new URLSearchParams();
  params.set("metodo", "envio");
  params.set("usuario", IAGENTE_USER);
  params.set("senha", IAGENTE_PASS);
  params.set("celular", to);
  params.set("mensagem", text);
  if (codeSms) params.set("codigosms", codeSms);

  const url = `${IAGENTE_BASE_URL}?${params.toString()}`;

  const res = await fetch(url, { method: "GET" });
  const bodyText = await res.text();

  // Resposta típica: "OK" ou "ERRO - ..."
  const ok = /^OK/i.test((bodyText || "").trim());

  return {
    ok,
    raw: (bodyText || "").trim()
  };
}

// ======================================================
// LISTAR
// ======================================================
router.get("/", requireAuth, async (_req, res) => {
  const db = loadDB();
  db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

  // Ordena mais novas primeiro
  const list = [...db.outboundSmsCampaigns].sort(
    (a, b) => String(b.createdAt).localeCompare(String(a.createdAt))
  );

  res.json({ ok: true, items: list });
});

// ======================================================
// CRIAR CAMPANHA
// ======================================================
router.post(
  "/",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
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
        status: "draft", // draft | ready | running | finished | failed
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
  }
);

// ======================================================
// UPLOAD AUDIÊNCIA (CSV TEXT)
// body: { csvText: "numero;var_1\n5511999999999;João" }
// ======================================================
router.post(
  "/:id/audience",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { csvText } = req.body || {};

      const db = loadDB();
      db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

      const camp = db.outboundSmsCampaigns.find((c) => c.id === id);
      if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

      const rows = parseCsvToRows(csvText);

      camp.audienceRows = rows.map((r, idx) => ({
        ...r,
        codeSms: `sms_${id}_${idx}_${Date.now()}`
      }));
      camp.audienceCount = camp.audienceRows.length;
      camp.status = camp.audienceCount ? "ready" : "draft";
      camp.updatedAt = nowIso();

      saveDB(db);

      res.json({ ok: true, audienceCount: camp.audienceCount });
    } catch (e) {
      logger.warn({ err: e }, "⚠️ Erro ao importar audiência SMS");
      res.status(400).json({ ok: false, error: e.message || "Erro ao importar CSV." });
    }
  }
);

// ======================================================
// START DISPARO
// ======================================================
router.post(
  "/:id/start",
  requireAuth,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const db = loadDB();
      db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

      const camp = db.outboundSmsCampaigns.find((c) => c.id === id);
      if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

      if (!camp.audienceRows?.length) {
        return res.status(400).json({ ok: false, error: "Campanha sem audiência." });
      }

      camp.status = "running";
      camp.updatedAt = nowIso();
      camp.results = camp.results || [];
      saveDB(db);

      // Disparo sequencial (simples e rastreável)
      let sent = 0;
      let failed = 0;

      for (const row of camp.audienceRows) {
        const text = applyVars(camp.message, row.vars);

        try {
          const r = await iagenteSendSms({
            to: row.phone,
            text,
            codeSms: row.codeSms
          });

          camp.results.push({
            phone: row.phone,
            codeSms: row.codeSms,
            status: r.ok ? "sent" : "failed",
            providerRaw: r.raw,
            updatedAt: nowIso()
          });

          if (r.ok) sent++;
          else failed++;
        } catch (err) {
          camp.results.push({
            phone: row.phone,
            codeSms: row.codeSms,
            status: "failed",
            providerRaw: "",
            error: err.message || String(err),
            updatedAt: nowIso()
          });
          failed++;
        }
      }

      camp.status = failed ? (sent ? "finished" : "failed") : "finished";
      camp.updatedAt = nowIso();
      saveDB(db);

      res.json({ ok: true, sent, failed, status: camp.status });
    } catch (e) {
      logger.error({ err: e }, "❌ Erro ao iniciar SMS Campaign");
      res.status(500).json({ ok: false, error: "Erro interno ao iniciar campanha SMS." });
    }
  }
);

// ======================================================
// REPORT
// ======================================================
router.get("/:id/report", requireAuth, async (req, res) => {
  const { id } = req.params;

  const db = loadDB();
  db.outboundSmsCampaigns = ensureArray(db.outboundSmsCampaigns);

  const camp = db.outboundSmsCampaigns.find((c) => c.id === id);
  if (!camp) return res.status(404).json({ ok: false, error: "Campanha não encontrada." });

  const total = camp.audienceCount || camp.audienceRows?.length || 0;
  const sent = (camp.results || []).filter((r) => r.status === "sent").length;
  const failed = (camp.results || []).filter((r) => r.status === "failed").length;

  res.json({
    ok: true,
    id: camp.id,
    name: camp.name,
    status: camp.status,
    total,
    sent,
    failed,
    results: camp.results || []
  });
});

export default router;
