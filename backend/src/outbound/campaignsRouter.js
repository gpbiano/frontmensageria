// backend/src/outbound/campaignsRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import logger from "../logger.js";

const router = express.Router();

// Usamos o mesmo data.json do resto da plataforma
const DB_FILE = path.join(process.cwd(), "data.json");

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
 * - aceita colunas: numero (ou number/phone)
 * - ignora linhas vazias
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
  const digits = String(value || "").replace(/\D/g, "");
  return digits;
}

function pickPhoneField(row) {
  // tenta achar um campo de telefone
  const keys = Object.keys(row || {});
  const candidates = ["numero", "number", "phone", "telefone", "celular"];
  const foundKey =
    candidates.find((k) => keys.includes(k)) ||
    keys.find((k) => candidates.includes(k.toLowerCase()));
  return foundKey ? row[foundKey] : "";
}

/* ============================================================
   CAMPANHAS (MVP)
   ============================================================ */

/**
 * GET /outbound/campaigns
 * Lista campanhas
 */
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

/**
 * POST /outbound/campaigns
 * Cria campanha (PASSO 1 do Wizard)
 */
router.post("/", (req, res) => {
  try {
    const { name, numberId, templateName, excludeOptOut } = req.body || {};

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
      excludeOptOut: !!excludeOptOut,
      status: "draft", // draft | ready | sending | done | failed
      createdAt: now,
      updatedAt: now,

      // audiência
      audience: {
        fileName: null,
        totalRows: 0,
        validRows: 0,
        invalidRows: 0
      },

      // logs simples
      logs: [
        {
          at: now,
          type: "created",
          message: "Campanha criada"
        }
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

/**
 * POST /outbound/campaigns/:id/audience
 * Upload CSV audiência (PASSO 2 do Wizard)
 *
 * Form-data:
 * - file: CSV
 */
router.post("/:id/audience", upload.single("file"), (req, res) => {
  try {
    const { id } = req.params;

    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));

    if (!campaign) {
      return res.status(404).json({ error: "Campanha não encontrada." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "Arquivo CSV não enviado." });
    }

    const csvText = req.file.buffer.toString("utf-8");
    const { rows } = parseCsvBasic(csvText);

    const phones = [];
    let invalid = 0;

    for (const row of rows) {
      const rawPhone = pickPhoneField(row);
      const phone = normalizePhoneDigits(rawPhone);
      if (!phone || phone.length < 10) {
        invalid++;
        continue;
      }
      phones.push(phone);
    }

    const now = new Date().toISOString();

    // MVP: guardamos os telefones dentro do data.json (ok pra pouca base)
    // Depois: guardar em arquivo por campanha, ou DB.
    campaign.audiencePhones = phones;
    campaign.audience = {
      fileName: req.file.originalname,
      totalRows: rows.length,
      validRows: phones.length,
      invalidRows: invalid
    };
    campaign.status = "ready";
    campaign.updatedAt = now;
    campaign.logs = campaign.logs || [];
    campaign.logs.push({
      at: now,
      type: "audience_uploaded",
      message: `Audiência carregada (${phones.length} válidos, ${invalid} inválidos)`
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

/**
 * POST /outbound/campaigns/:id/start
 * Inicia a campanha (PASSO 3 do Wizard)
 *
 * MVP: por enquanto apenas muda status e registra log.
 * Depois ligamos na Meta para disparo real / filas / controle de custo.
 */
router.post("/:id/start", async (req, res) => {
  try {
    const { id } = req.params;

    const db = loadDB();
    const campaigns = ensureCampaigns(db);
    const campaign = campaigns.find((c) => String(c.id) === String(id));

    if (!campaign) {
      return res.status(404).json({ error: "Campanha não encontrada." });
    }

    if (campaign.status !== "ready" && campaign.status !== "draft") {
      return res.status(400).json({
        error: `Campanha não pode iniciar com status "${campaign.status}".`
      });
    }

    const audienceCount = Array.isArray(campaign.audiencePhones)
      ? campaign.audiencePhones.length
      : 0;

    if (audienceCount === 0) {
      return res.status(400).json({
        error:
          "Audiência vazia. Faça upload do CSV antes de iniciar a campanha."
      });
    }

    const now = new Date().toISOString();

    // MVP: marca como sending e finaliza como done rapidamente
    campaign.status = "sending";
    campaign.updatedAt = now;
    campaign.logs = campaign.logs || [];
    campaign.logs.push({
      at: now,
      type: "start_requested",
      message: `Início solicitado (${audienceCount} destinatários)`
    });

    // Aqui, no futuro:
    // - enfileirar envios
    // - disparar WhatsApp Cloud API
    // - salvar métricas (delivered/read/failed)
    // - custo estimado
    campaign.status = "done";
    campaign.logs.push({
      at: new Date().toISOString(),
      type: "finished",
      message: "MVP: campanha marcada como concluída (envio real será implementado)"
    });

    saveDB(db);

    return res.json({
      success: true,
      campaignId: campaign.id,
      status: campaign.status
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao iniciar campanha");
    return res.status(500).json({ error: "Erro ao iniciar campanha." });
  }
});

export default router;
