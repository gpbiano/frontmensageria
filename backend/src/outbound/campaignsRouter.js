// backend/src/outbound/campaignsRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import logger from "../logger.js";

const router = express.Router();

// Usa o mesmo DB_FILE do index (compatível com env)
const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(process.cwd(), "data.json");

// ===============================
// ✅ Env WhatsApp (compat)
// Aceita tanto PHONE_NUMBER_ID quanto WHATSAPP_PHONE_NUMBER_ID
// ===============================
function getWhatsAppEnv() {
  const token = String(process.env.WHATSAPP_TOKEN || "").trim();

  // compatível com env novo e legado
  const phoneNumberId = String(
    process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
  ).trim();

  const apiVersion = String(process.env.WHATSAPP_API_VERSION || "v20.0").trim();

  return { token, phoneNumberId, apiVersion };
}

function assertWhatsAppConfigured() {
  const { token, phoneNumberId, apiVersion } = getWhatsAppEnv();
  if (!token || !phoneNumberId) {
    throw new Error(
      "Env WhatsApp ausente (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID ou PHONE_NUMBER_ID)."
    );
  }
  return { token, phoneNumberId, apiVersion };
}

// Upload em memória (CSV pequeno/medio). Depois podemos evoluir.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err, DB_FILE },
      "⚠️ Falha ao carregar DB em campaignsRouter, usando objeto vazio."
    );
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err, DB_FILE }, "❌ Erro ao salvar DB em campaignsRouter");
  }
}

function ensureCampaigns(db) {
  if (!Array.isArray(db.outboundCampaigns)) db.outboundCampaigns = [];
  return db.outboundCampaigns;
}

function newId(prefix = "cmp") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

/**
 * Parse CSV simples:
 * - separador: vírgula
 * - primeira linha: header
 * - aceita colunas: numero (ou number/phone/telefone/celular)
 * - e variáveis: body_var_1..N
 *
 * OBS: MVP. Depois melhoramos para RFC4180, separador ;, aspas, etc.
 */
function parseCsvBasic(text) {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return { headers: [], rows: [] };

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cols[idx] ?? "";
    });
    return obj;
  });

  return { headers, rows };
}

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function pickPhoneField(row) {
  const keys = Object.keys(row || {});
  const candidates = ["numero", "number", "phone", "telefone", "celular"];
  const foundKey =
    candidates.find((k) => keys.includes(k)) ||
    keys.find((k) => candidates.includes(k.toLowerCase()));
  return foundKey ? row[foundKey] : "";
}

function pickBodyVars(row) {
  // pega body_var_1..body_var_99 (se existir)
  const vars = [];
  for (let i = 1; i <= 99; i++) {
    const key = `body_var_${i}`;
    if (!(key in row)) break;
    vars.push(String(row[key] ?? ""));
  }
  return vars;
}

function normalizeMetaError(err) {
  if (!err) return null;
  const e = err?.error ? err.error : err;
  return {
    code: e?.code ?? e?.error_code ?? e?.errorCode ?? null,
    message: e?.message ?? e?.error_user_msg ?? e?.errorMessage ?? null,
    type: e?.type ?? null,
    subcode: e?.error_subcode ?? e?.subcode ?? null,
    trace: e?.fbtrace_id ?? null
  };
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function buildCampaignReport(campaign) {
  const results = Array.isArray(campaign?.results) ? campaign.results : [];

  const sent = results.filter((r) =>
    ["sent", "delivered", "read"].includes(safeLower(r?.status))
  ).length;
  const delivered = results.filter((r) =>
    ["delivered", "read"].includes(safeLower(r?.status))
  ).length;
  const read = results.filter((r) => safeLower(r?.status) === "read").length;
  const failed = results.filter((r) => safeLower(r?.status) === "failed").length;

  const timeline = {
    startedAt:
      campaign?.timeline?.startedAt ||
      campaign?.logs?.find((l) => l?.type === "start_requested")?.at ||
      campaign?.createdAt ||
      null,
    finishedAt:
      campaign?.timeline?.finishedAt ||
      [...(campaign?.logs || [])].reverse().find((l) => l?.type === "finished")?.at ||
      null
  };

  return {
    campaignId: campaign?.id,
    name: campaign?.name,
    status: campaign?.status,
    templateName: campaign?.templateName,
    templateLanguage: campaign?.templateLanguage,
    numberId: campaign?.numberId,
    createdAt: campaign?.createdAt,
    updatedAt: campaign?.updatedAt,
    sent,
    delivered,
    read,
    failed,
    timeline,
    results: results.map((r) => {
      const metaErr = normalizeMetaError(
        r?.metaError || r?.meta || r?.error || r?.waError
      );
      return {
        phone: r?.phone || "",
        status: r?.status || "",
        waMessageId: r?.waMessageId || "",
        updatedAt: r?.updatedAt || r?.at || r?.timestamp || "",
        errorCode: metaErr?.code != null ? String(metaErr.code) : "",
        errorMessage: metaErr?.message
          ? String(metaErr.message)
          : r?.error
          ? String(r.error)
          : ""
      };
    })
  };
}

function reportToCsv(report, req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const shortLinkBase = `${origin}/r/meta-error/`;

  const lines = [];

  lines.push(`# CampaignId: ${report.campaignId}`);
  lines.push(`# Name: ${report.name || ""}`);
  lines.push(`# Status: ${report.status || ""}`);
  lines.push(
    `# Template: ${report.templateName || ""} (${report.templateLanguage || ""})`
  );
  lines.push(`# CreatedAt: ${report.createdAt || ""}`);
  lines.push(`# UpdatedAt: ${report.updatedAt || ""}`);
  lines.push(`# StartedAt: ${report.timeline?.startedAt || ""}`);
  lines.push(`# FinishedAt: ${report.timeline?.finishedAt || ""}`);
  lines.push(
    `# Sent: ${report.sent} | Failed: ${report.failed} | Delivered: ${report.delivered} | Read: ${report.read}`
  );
  lines.push("");

  lines.push(
    [
      "phone",
      "status",
      "waMessageId",
      "updatedAt",
      "errorCode",
      "errorMessage",
      "metaErrorLink"
    ].join(",")
  );

  for (const r of report.results || []) {
    const link = r.errorCode
      ? `${shortLinkBase}${encodeURIComponent(r.errorCode)}`
      : "";
    lines.push(
      [
        csvEscape(r.phone),
        csvEscape(r.status),
        csvEscape(r.waMessageId),
        csvEscape(r.updatedAt),
        csvEscape(r.errorCode),
        csvEscape(r.errorMessage),
        csvEscape(link)
      ].join(",")
    );
  }

  return lines.join("\n");
}

function safeFileName(name) {
  return String(name || "campaign")
    .replace(/[^\w\-]+/g, "_")
    .slice(0, 60);
}

function formatBR(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return String(iso);
  }
}

function drawCard(doc, x, y, w, h, title, value, subtitle) {
  doc.roundedRect(x, y, w, h, 10).fillAndStroke("#F8FAFC", "#E2E8F0");

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(title, x + 12, y + 10, { width: w - 24 });

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#14532D")
    .text(String(value ?? ""), x + 12, y + 28, { width: w - 24 });

  if (subtitle) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#334155")
      .text(subtitle, x + 12, y + 56, { width: w - 24 });
  }
}

function exportReportPdf(report, campaignName, req, res) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const shortLinkBase = `${origin}/r/meta-error/`;

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, left: 40, right: 40, bottom: 40 }
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="campaign_${safeFileName(campaignName)}_${report.campaignId}.pdf"`
  );

  doc.pipe(res);

  // Header
  doc.rect(0, 0, doc.page.width, 84).fill("#0B1220");

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("GP Labs", 40, 24);

  doc
    .fillColor("#A7F3D0")
    .font("Helvetica")
    .fontSize(10)
    .text("Relatório de Campanha • WhatsApp Cloud API", 40, 50);

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(`#${report.campaignId}`, doc.page.width - 240, 28, {
      width: 200,
      align: "right"
    });

  // Body start
  let y = 100;

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(16)
    .text(report.name || "Campanha", 40, y);

  y += 22;
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#334155")
    .text(
      `Status: ${report.status || "-"}   •   Template: ${report.templateName || "-"} (${report.templateLanguage || "-"})   •   Número: ${report.numberId || "-"}`,
      40,
      y
    );

  y += 14;
  doc
    .fontSize(10)
    .fillColor("#334155")
    .text(
      `Criada: ${formatBR(report.createdAt)}   •   Atualizada: ${formatBR(report.updatedAt)}   •   Início: ${formatBR(
        report.timeline?.startedAt
      )}   •   Fim: ${formatBR(report.timeline?.finishedAt)}`,
      40,
      y
    );

  y += 24;

  // Cards
  const cardW = (doc.page.width - 80 - 30) / 4;
  const cardH = 78;
  const gap = 10;

  drawCard(doc, 40, y, cardW, cardH, "Enviadas", report.sent, null);
  drawCard(
    doc,
    40 + (cardW + gap) * 1,
    y,
    cardW,
    cardH,
    "Entregues",
    report.delivered,
    "Depende de status webhook"
  );
  drawCard(
    doc,
    40 + (cardW + gap) * 2,
    y,
    cardW,
    cardH,
    "Lidas",
    report.read,
    "Depende de status webhook"
  );
  drawCard(doc, 40 + (cardW + gap) * 3, y, cardW, cardH, "Falhas", report.failed, null);

  y += cardH + 18;

  // Section title
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#0F172A")
    .text("Destinatários", 40, y);

  y += 10;

  // Table header
  const tableTop = y + 10;
  const col1 = 40; // Telefone
  const col2 = 190; // Status
  const col3 = 280; // Erro
  const col4 = 520; // Atualizado
  const rowH = 18;

  doc
    .roundedRect(40, tableTop, doc.page.width - 80, 26, 8)
    .fillAndStroke("#F1F5F9", "#E2E8F0");

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("Telefone", col1 + 8, tableTop + 8)
    .text("Status", col2 + 8, tableTop + 8)
    .text("Erro (Meta)", col3 + 8, tableTop + 8)
    .text("Atualizado", col4 - 70, tableTop + 8, { width: 110, align: "right" });

  y = tableTop + 32;

  const maxRows = 22;
  const rows = (report.results || []).slice(0, maxRows);

  doc.font("Helvetica").fontSize(9).fillColor("#0F172A");

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];

    if (y + rowH > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }

    if (i % 2 === 1) {
      doc.rect(40, y - 2, doc.page.width - 80, rowH).fill("#FAFAFA");
    }

    const errText = r.errorCode
      ? `#${r.errorCode} • ${shortLinkBase}${encodeURIComponent(r.errorCode)}`
      : "-";

    doc
      .fillColor("#0F172A")
      .text(r.phone || "-", col1 + 8, y, { width: 140 })
      .text(r.status || "-", col2 + 8, y, { width: 80 })
      .fillColor(r.errorCode ? "#991B1B" : "#334155")
      .text(errText, col3 + 8, y, { width: 220 })
      .fillColor("#334155")
      .text(formatBR(r.updatedAt), col4 - 70, y, { width: 110, align: "right" });

    y += rowH;
  }

  if ((report.results || []).length > maxRows) {
    y += 10;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#334155")
      .text(
        `Mostrando ${maxRows} de ${(report.results || []).length} destinatários. Use o CSV para exportação completa.`,
        40,
        y
      );
  }

  // Footer
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#64748B")
    .text(
      `Gerado em ${new Date().toLocaleString("pt-BR")} • GP Labs Platform`,
      40,
      doc.page.height - 30,
      { width: doc.page.width - 80, align: "right" }
    );

  doc.end();
}

async function sendWhatsAppTemplate(to, templateName, languageCode, bodyVars = []) {
  const { token, phoneNumberId, apiVersion } = assertWhatsAppConfigured();

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const components = [];
  if (Array.isArray(bodyVars) && bodyVars.length > 0) {
    components.push({
      type: "body",
      parameters: bodyVars.map((v) => ({ type: "text", text: String(v) }))
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode || "pt_BR" },
      ...(components.length ? { components } : {})
    }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error?.message || data?.message || `Erro WhatsApp (${res.status})`;
    const err = new Error(msg);
    err.meta = data?.error || data || null;
    throw err;
  }

  return data;
}

/* ============================================================
   ANALYTICS EXPORT (CSV/PDF) – TODOS / FILTRADOS
   - GET /outbound/campaigns/analytics/export.csv?from=YYYY-MM-DD&to=YYYY-MM-DD&campaignId=all|<id>&template=all|<name>
   - GET /outbound/campaigns/analytics/export.pdf?from=YYYY-MM-DD&to=YYYY-MM-DD&campaignId=all|<id>&template=all|<name>
   ============================================================ */

function toRangeTimestamps(from, to) {
  const fromTs = from ? new Date(`${from}T00:00:00`).getTime() : null;
  const toTs = to ? new Date(`${to}T23:59:59`).getTime() : null;
  return { fromTs, toTs };
}

function campaignCreatedTs(c) {
  const ts = c?.createdAt ? new Date(c.createdAt).getTime() : null;
  return Number.isFinite(ts) ? ts : null;
}

function filterCampaignsForAnalytics(campaigns, query) {
  const from = query?.from ? String(query.from) : "";
  const to = query?.to ? String(query.to) : "";
  const campaignId = query?.campaignId ? String(query.campaignId) : "all";
  const template = query?.template ? String(query.template) : "all";

  const { fromTs, toTs } = toRangeTimestamps(from, to);

  return (campaigns || []).filter((c) => {
    const ts = campaignCreatedTs(c);

    if (fromTs && ts && ts < fromTs) return false;
    if (toTs && ts && ts > toTs) return false;

    if (campaignId !== "all" && String(c?.id) !== String(campaignId)) return false;
    if (template !== "all" && String(c?.templateName || "") !== String(template))
      return false;

    return true;
  });
}

function buildAnalyticsReport(campaigns, meta = {}) {
  const rows = [];

  for (const c of campaigns || []) {
    const results = Array.isArray(c?.results) ? c.results : [];
    for (const r of results) {
      const st = safeLower(r?.status || "sent");
      const err =
        r?.errorCode ??
        r?.metaErrorCode ??
        r?.metaError?.code ??
        r?.error?.code ??
        r?.meta?.code ??
        null;

      const errMsg =
        r?.errorMessage ??
        r?.metaErrorMessage ??
        r?.metaError?.message ??
        r?.error ??
        r?.metaError?.message ??
        "";

      rows.push({
        campaignId: c?.id || "",
        campaignName: c?.name || "",
        templateName: c?.templateName || "",
        templateLanguage: c?.templateLanguage || "",
        numberId: c?.numberId || "",
        createdAt: c?.createdAt || "",
        phone: r?.phone || "",
        status: st,
        waMessageId: r?.waMessageId || "",
        updatedAt: r?.updatedAt || "",
        errorCode: err != null ? String(err) : "",
        errorMessage: errMsg ? String(errMsg) : ""
      });
    }
  }

  const total = rows.length;
  const delivered = rows.filter((r) => r.status === "delivered").length;
  const read = rows.filter((r) => r.status === "read").length;
  const failed = rows.filter((r) => r.status === "failed").length;

  const deliveryRate = total ? (delivered / total) * 100 : 0;
  const readRate = total ? (read / total) * 100 : 0;
  const failRate = total ? (failed / total) * 100 : 0;

  return {
    meta,
    totals: { total, delivered, read, failed, deliveryRate, readRate, failRate },
    rows
  };
}

function analyticsToCsv(analytics, req) {
  const origin = `${req.protocol}://${req.get("host")}`;
  const shortLinkBase = `${origin}/r/meta-error/`;

  const lines = [];
  const meta = analytics.meta || {};
  const totals = analytics.totals || {};

  lines.push(`# GP Labs – Analytics Export`);
  lines.push(`# GeneratedAt: ${new Date().toISOString()}`);
  lines.push(
    `# Filters: from=${meta.from || ""} to=${meta.to || ""} campaignId=${
      meta.campaignId || "all"
    } template=${meta.template || "all"}`
  );
  lines.push(
    `# Totals: total=${totals.total || 0} delivered=${
      totals.delivered || 0
    } read=${totals.read || 0} failed=${
      totals.failed || 0
    } | deliveryRate=${
      (totals.deliveryRate || 0).toFixed?.(1) ?? totals.deliveryRate
    } readRate=${
      (totals.readRate || 0).toFixed?.(1) ?? totals.readRate
    } failRate=${(totals.failRate || 0).toFixed?.(1) ?? totals.failRate}`
  );
  lines.push("");

  lines.push(
    [
      "campaignId",
      "campaignName",
      "templateName",
      "templateLanguage",
      "numberId",
      "createdAt",
      "phone",
      "status",
      "waMessageId",
      "updatedAt",
      "errorCode",
      "errorMessage",
      "metaErrorLink"
    ].join(",")
  );

  for (const r of analytics.rows || []) {
    const link = r.errorCode
      ? `${shortLinkBase}${encodeURIComponent(r.errorCode)}`
      : "";
    lines.push(
      [
        csvEscape(r.campaignId),
        csvEscape(r.campaignName),
        csvEscape(r.templateName),
        csvEscape(r.templateLanguage),
        csvEscape(r.numberId),
        csvEscape(r.createdAt),
        csvEscape(r.phone),
        csvEscape(r.status),
        csvEscape(r.waMessageId),
        csvEscape(r.updatedAt),
        csvEscape(r.errorCode),
        csvEscape(r.errorMessage),
        csvEscape(link)
      ].join(",")
    );
  }

  return lines.join("\n");
}

function exportAnalyticsPdf(analytics, req, res) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, left: 40, right: 40, bottom: 40 }
  });

  const meta = analytics.meta || {};
  const totals = analytics.totals || {};
  const rows = Array.isArray(analytics.rows) ? analytics.rows : [];

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="analytics_${safeFileName(meta.template || "all")}_${
      meta.campaignId || "all"
    }_${Date.now()}.pdf"`
  );

  doc.pipe(res);

  // Header
  doc.rect(0, 0, doc.page.width, 84).fill("#0B1220");

  doc
    .fillColor("#FFFFFF")
    .font("Helvetica-Bold")
    .fontSize(18)
    .text("GP Labs", 40, 24);

  doc
    .fillColor("#A7F3D0")
    .font("Helvetica")
    .fontSize(10)
    .text("Analytics • Exportação PDF (filtros aplicados)", 40, 50);

  // Body
  let y = 100;

  doc.fillColor("#0F172A").font("Helvetica-Bold").fontSize(14).text("Resumo", 40, y);

  y += 18;

  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#334155")
    .text(
      `Filtros: De ${meta.from || "-"} até ${meta.to || "-"}   •   Campanha: ${
        meta.campaignId || "all"
      }   •   Template: ${meta.template || "all"}`,
      40,
      y
    );

  y += 18;

  const cardW = (doc.page.width - 80 - 30) / 4;
  const cardH = 78;
  const gap = 10;

  drawCard(doc, 40, y, cardW, cardH, "Total", totals.total || 0, null);
  drawCard(
    doc,
    40 + (cardW + gap) * 1,
    y,
    cardW,
    cardH,
    "Entregues",
    totals.delivered || 0,
    `${(totals.deliveryRate || 0).toFixed(1)}%`
  );
  drawCard(
    doc,
    40 + (cardW + gap) * 2,
    y,
    cardW,
    cardH,
    "Lidas",
    totals.read || 0,
    `${(totals.readRate || 0).toFixed(1)}%`
  );
  drawCard(
    doc,
    40 + (cardW + gap) * 3,
    y,
    cardW,
    cardH,
    "Falhas",
    totals.failed || 0,
    `${(totals.failRate || 0).toFixed(1)}%`
  );

  y += cardH + 18;

  // Destinatários (primeiras linhas – para caber)
  doc
    .font("Helvetica-Bold")
    .fontSize(12)
    .fillColor("#0F172A")
    .text("Detalhes (amostra)", 40, y);

  y += 10;

  const tableTop = y + 10;
  const rowH = 18;

  doc
    .roundedRect(40, tableTop, doc.page.width - 80, 26, 8)
    .fillAndStroke("#F1F5F9", "#E2E8F0");

  doc
    .fillColor("#0F172A")
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("Campanha", 48, tableTop + 8, { width: 150 })
    .text("Telefone", 210, tableTop + 8, { width: 110 })
    .text("Status", 325, tableTop + 8, { width: 70 })
    .text("Erro", 395, tableTop + 8, { width: 160 });

  y = tableTop + 32;

  const maxRows = 22;
  const slice = rows.slice(0, maxRows);

  doc.font("Helvetica").fontSize(9).fillColor("#0F172A");

  for (let i = 0; i < slice.length; i++) {
    const r = slice[i];

    if (y + rowH > doc.page.height - 60) {
      doc.addPage();
      y = 40;
    }

    if (i % 2 === 1) {
      doc.rect(40, y - 2, doc.page.width - 80, rowH).fill("#FAFAFA");
    }

    doc
      .fillColor("#0F172A")
      .text((r.campaignName || r.campaignId || "-").slice(0, 26), 48, y, {
        width: 150
      })
      .text(r.phone || "-", 210, y, { width: 110 })
      .text(r.status || "-", 325, y, { width: 70 })
      .fillColor(r.errorCode ? "#991B1B" : "#334155")
      .text(r.errorCode ? `#${r.errorCode}` : "-", 395, y, { width: 160 });

    y += rowH;
  }

  if (rows.length > maxRows) {
    y += 10;
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#334155")
      .text(
        `Mostrando ${maxRows} de ${rows.length} linhas. Para exportação completa use o CSV.`,
        40,
        y
      );
  }

  // Footer
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor("#64748B")
    .text(`Gerado em ${new Date().toLocaleString("pt-BR")} • GP Labs Platform`, 40, doc.page.height - 30, {
      width: doc.page.width - 80,
      align: "right"
    });

  doc.end();
}

// ⚠️ IMPORTANTE: essa rota precisa ficar ANTES de "/:id" se você usar "/analytics/..."
router.get("/analytics/export.csv", (req, res) => {
  try {
    const db = loadDB();
    const campaigns = ensureCampaigns(db);

    const filtered = filterCampaignsForAnalytics(campaigns, req.query);

    const meta = {
      from: req.query?.from ? String(req.query.from) : "",
      to: req.query?.to ? String(req.query.to) : "",
      campaignId: req.query?.campaignId ? String(req.query.campaignId) : "all",
      template: req.query?.template ? String(req.query.template) : "all"
    };

    const analytics = buildAnalyticsReport(filtered, meta);
    const csv = analyticsToCsv(analytics, req);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="analytics_${safeFileName(meta.template)}_${meta.campaignId}_${Date.now()}.csv"`
    );
    return res.status(200).send(csv);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao exportar Analytics CSV");
    return res.status(500).json({ error: "Erro ao exportar CSV do Analytics." });
  }
});

router.get("/analytics/export.pdf", (req, res) => {
  try {
    const db = loadDB();
    const campaigns = ensureCampaigns(db);

    const filtered = filterCampaignsForAnalytics(campaigns, req.query);

    const meta = {
      from: req.query?.from ? String(req.query.from) : "",
      to: req.query?.to ? String(req.query.to) : "",
      campaignId: req.query?.campaignId ? String(req.query.campaignId) : "all",
      template: req.query?.template ? String(req.query.template) : "all"
    };

    const analytics = buildAnalyticsReport(filtered, meta);
    return exportAnalyticsPdf(analytics, req, res);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao exportar Analytics PDF");
    return res.status(500).json({ error: "Erro ao exportar PDF do Analytics." });
  }
});

/* ============================================================
   ROTAS PRINCIPAIS
   ============================================================ */

router.get("/", (req, res) => {
  try {
    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    return res.json(campaigns);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao listar campanhas");
    return res.status(500).json({ error: "Erro ao listar campanhas." });
  }
});

// ⚠️ mantenha "/:id" DEPOIS das rotas fixas (ex: "/analytics/...")
router.get("/:id", (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));
    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });
    return res.json(campaign);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao buscar campanha");
    return res.status(500).json({ error: "Erro ao buscar campanha." });
  }
});

router.post("/", (req, res) => {
  try {
    const { name, numberId, templateName, templateLanguage, excludeOptOut } =
      req.body || {};

    if (!name || !numberId || !templateName) {
      return res.status(400).json({
        error: "Campos obrigatórios: name, numberId, templateName"
      });
    }

    const db = loadDB();
    const campaigns = ensureCampaigns(db);

    const now = new Date().toISOString();

    const campaign = {
      id: newId("cmp"),
      name: String(name),
      numberId: String(numberId),
      templateName: String(templateName),
      templateLanguage: String(templateLanguage || "pt_BR"),
      excludeOptOut: !!excludeOptOut,
      status: "draft", // draft | ready | sending | done | failed
      createdAt: now,
      updatedAt: now,

      audience: { fileName: null, totalRows: 0, validRows: 0, invalidRows: 0 },
      audienceRows: [],
      results: [],
      logs: [{ at: now, type: "created", message: "Campanha criada" }],
      timeline: {}
    };

    campaigns.unshift(campaign);
    saveDB(db);

    return res.json(campaign);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao criar campanha");
    return res.status(500).json({ error: "Erro ao criar campanha." });
  }
});

router.post("/:id/audience", upload.single("file"), (req, res) => {
  try {
    const { id } = req.params;

    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));

    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });
    if (!req.file) return res.status(400).json({ error: "Arquivo CSV não enviado." });

    const csvText = req.file.buffer.toString("utf-8");
    const { rows } = parseCsvBasic(csvText);

    const validRows = [];
    let invalid = 0;

    for (const row of rows) {
      const rawPhone = pickPhoneField(row);
      const phone = normalizePhoneDigits(rawPhone);
      if (!phone || phone.length < 10) {
        invalid++;
        continue;
      }
      validRows.push({ phone, vars: pickBodyVars(row) });
    }

    const now = new Date().toISOString();

    campaign.audienceRows = validRows;
    campaign.audience = {
      fileName: req.file.originalname,
      totalRows: rows.length,
      validRows: validRows.length,
      invalidRows: invalid
    };
    campaign.status = "ready";
    campaign.updatedAt = now;
    campaign.logs = campaign.logs || [];
    campaign.logs.push({
      at: now,
      type: "audience_uploaded",
      message: `Audiência carregada (${validRows.length} válidos, ${invalid} inválidos)`
    });

    saveDB(db);

    return res.json({
      success: true,
      campaignId: campaign.id,
      fileName: campaign.audience.fileName,
      totalRows: campaign.audience.totalRows,
      validRows: campaign.audience.validRows,
      invalidRows: campaign.audience.invalidRows
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao enviar audiência");
    return res.status(500).json({ error: "Erro ao enviar audiência." });
  }
});

router.post("/:id/start", async (req, res) => {
  try {
    const { id } = req.params;

    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));

    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });
    if (campaign.status !== "ready" && campaign.status !== "draft") {
      return res.status(400).json({
        error: `Campanha não pode iniciar com status "${campaign.status}".`
      });
    }

    const rows = Array.isArray(campaign.audienceRows) ? campaign.audienceRows : [];
    if (rows.length === 0) {
      return res.status(400).json({
        error: "Audiência vazia. Faça upload do CSV antes de iniciar a campanha."
      });
    }

    // ✅ valida env whatsapp aqui (mesma regra do sendWhatsAppTemplate)
    try {
      assertWhatsAppConfigured();
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }

    const now = new Date().toISOString();
    campaign.status = "sending";
    campaign.updatedAt = now;
    campaign.logs = campaign.logs || [];
    campaign.logs.push({
      at: now,
      type: "start_requested",
      message: `Início solicitado (${rows.length} destinatários)`
    });

    if (!campaign.timeline) campaign.timeline = {};
    if (!campaign.timeline.startedAt) campaign.timeline.startedAt = now;

    campaign.results = [];
    let sent = 0;
    let failed = 0;

    for (const r of rows) {
      const to = r.phone;

      try {
        const waResp = await sendWhatsAppTemplate(
          to,
          campaign.templateName,
          campaign.templateLanguage || "pt_BR",
          Array.isArray(r.vars) ? r.vars : []
        );

        const waMessageId = waResp?.messages?.[0]?.id || null;

        campaign.results.push({
          phone: to,
          status: "sent",
          waMessageId,
          updatedAt: new Date().toISOString()
        });

        sent++;
      } catch (err) {
        const metaErr = normalizeMetaError(err?.meta || null);
        const msg = metaErr?.message || err?.message || "Falha ao enviar";

        campaign.results.push({
          phone: to,
          status: "failed",
          updatedAt: new Date().toISOString(),
          error: msg,
          metaError: metaErr
        });

        failed++;
      }
    }

    campaign.status = failed > 0 && sent === 0 ? "failed" : "done";
    campaign.updatedAt = new Date().toISOString();
    campaign.logs.push({
      at: campaign.updatedAt,
      type: "finished",
      message: `Finalizada: ${sent} enviados, ${failed} falhas`
    });

    if (!campaign.timeline) campaign.timeline = {};
    campaign.timeline.finishedAt = campaign.updatedAt;

    saveDB(db);

    return res.json({
      success: true,
      campaignId: campaign.id,
      status: campaign.status,
      sent,
      failed
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao iniciar campanha");
    return res.status(500).json({ error: "Erro ao iniciar campanha." });
  }
});

// JSON Report 2.0
router.get("/:id/report", (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));
    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });

    const report = buildCampaignReport(campaign);
    return res.json(report);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao gerar report");
    return res.status(500).json({ error: "Erro ao gerar relatório." });
  }
});

// ✅ CSV Export (bate com o frontend: /outbound/campaigns/:id/export.csv)
router.get("/:id/export.csv", (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));
    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });

    const report = buildCampaignReport(campaign);
    const csv = reportToCsv(report, req);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="campaign_${safeFileName(campaign.name)}_${campaign.id}.csv"`
    );
    return res.status(200).send(csv);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao exportar CSV");
    return res.status(500).json({ error: "Erro ao exportar CSV." });
  }
});

// ✅ PDF Export (bate com o frontend: /outbound/campaigns/:id/export.pdf)
router.get("/:id/export.pdf", (req, res) => {
  try {
    const { id } = req.params;
    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));
    if (!campaign) return res.status(404).json({ error: "Campanha não encontrada." });

    const report = buildCampaignReport(campaign);
    return exportReportPdf(report, campaign.name, req, res);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao exportar PDF");
    return res.status(500).json({ error: "Erro ao exportar PDF." });
  }
});

export default router;
