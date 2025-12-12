// backend/src/outbound/campaignsRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

// Usamos o mesmo data.json do resto da plataforma
const DB_FILE = path.join(process.cwd(), "data.json");

// Env WhatsApp
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Upload em memória (CSV pequeno/medio). Depois podemos evoluir.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
});

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err },
      "⚠️ data.json não encontrado ao carregar em campaignsRouter, usando objeto vazio."
    );
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json em campaignsRouter");
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

  if (lines.length === 0) {
    return { headers: [], rows: [] };
  }

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

async function sendWhatsAppTemplate(to, templateName, languageCode, bodyVars = []) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("Configuração WhatsApp ausente (WHATSAPP_TOKEN/PHONE_NUMBER_ID)");
  }

  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const components = [];

  // BODY params (se tiver vars)
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
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.message ||
      `Erro WhatsApp (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

/* ============================================================
   CAMPANHAS
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

router.post("/", (req, res) => {
  try {
    const { name, numberId, templateName, templateLanguage, excludeOptOut } = req.body || {};

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

      audience: {
        fileName: null,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0
      },

      // guarda linhas completas (pra termos vars)
      audienceRows: [],

      logs: [
        { at: now, type: "created", message: "Campanha criada" }
      ]
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

    campaign.audienceRows = validRows; // ✅ agora temos vars por linha
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

    if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
      return res.status(500).json({
        error: "Env WhatsApp ausente (WHATSAPP_TOKEN/PHONE_NUMBER_ID)."
      });
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

    campaign.results = [];
    let sent = 0;
    let failed = 0;

    // ⚠️ MVP: envia sequencial (seguro). Depois fazemos fila/concorrência.
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
        campaign.results.push({ phone: to, status: "sent", waMessageId });
        sent++;
        logger.info({ to, waMessageId, campaignId: campaign.id }, "📤 Template enviado (campaigns)");
      } catch (err) {
        const msg = err?.message || "Falha ao enviar";
        campaign.results.push({ phone: to, status: "failed", error: msg });
        failed++;
        logger.error({ to, err: msg, campaignId: campaign.id }, "❌ Falha envio template (campaigns)");
      }
    }

    campaign.status = failed > 0 && sent === 0 ? "failed" : "done";
    campaign.updatedAt = new Date().toISOString();
    campaign.logs.push({
      at: campaign.updatedAt,
      type: "finished",
      message: `Finalizada: ${sent} enviados, ${failed} falhas`
    });

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

export default router;
