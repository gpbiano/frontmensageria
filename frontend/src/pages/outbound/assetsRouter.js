// backend/src/outbound/campaignsRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

const DB_FILE = path.join(process.cwd(), "data.json");

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

// Upload CSV
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

/* ===============================
   HELPERS BASE
=============================== */
function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function ensureCampaigns(db) {
  if (!Array.isArray(db.outboundCampaigns)) db.outboundCampaigns = [];
  return db.outboundCampaigns;
}

function newId(prefix = "cmp") {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function normalizePhone(value) {
  return String(value || "").replace(/\D/g, "");
}

/* ===============================
   WHATSAPP CLOUD API
=============================== */
async function sendTemplateMessage({ to, templateName, language = "pt_BR", components = [] }) {
  const url = `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: language },
      ...(components.length
        ? {
            components: [
              {
                type: "body",
                parameters: components.map((text) => ({
                  type: "text",
                  text: String(text)
                }))
              }
            ]
          }
        : {})
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

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || "Erro ao enviar template");
  }

  return data?.messages?.[0]?.id || null;
}

/* ===============================
   CAMPANHAS
=============================== */

// GET /outbound/campaigns
router.get("/", (req, res) => {
  const db = loadDB();
  res.json(ensureCampaigns(db));
});

// POST /outbound/campaigns
router.post("/", (req, res) => {
  const { name, numberId, templateName, excludeOptOut } = req.body || {};
  if (!name || !numberId || !templateName) {
    return res.status(400).json({ error: "Campos obrigatórios ausentes." });
  }

  const db = loadDB();
  const campaigns = ensureCampaigns(db);

  const now = new Date().toISOString();

  const campaign = {
    id: newId(),
    name,
    numberId,
    templateName,
    excludeOptOut: !!excludeOptOut,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    audiencePhones: [],
    audience: {},
    logs: [{ at: now, type: "created", message: "Campanha criada" }],
    results: []
  };

  campaigns.unshift(campaign);
  saveDB(db);
  res.json(campaign);
});

// POST /outbound/campaigns/:id/audience
router.post("/:id/audience", upload.single("file"), (req, res) => {
  const db = loadDB();
  const campaigns = ensureCampaigns(db);
  const campaign = campaigns.find((c) => c.id === req.params.id);

  if (!campaign || !req.file) {
    return res.status(400).json({ error: "Campanha ou arquivo inválido." });
  }

  const rows = req.file.buffer
    .toString("utf-8")
    .split("\n")
    .slice(1)
    .map((l) => normalizePhone(l.split(",")[0]))
    .filter((p) => p.length >= 10);

  campaign.audiencePhones = rows;
  campaign.audience.validRows = rows.length;
  campaign.status = "ready";
  campaign.updatedAt = new Date().toISOString();

  saveDB(db);
  res.json({ success: true, total: rows.length });
});

// POST /outbound/campaigns/:id/start
router.post("/:id/start", async (req, res) => {
  const db = loadDB();
  const campaigns = ensureCampaigns(db);
  const campaign = campaigns.find((c) => c.id === req.params.id);

  if (!campaign) {
    return res.status(404).json({ error: "Campanha não encontrada." });
  }

  campaign.status = "sending";
  campaign.updatedAt = new Date().toISOString();
  saveDB(db);

  for (const phone of campaign.audiencePhones) {
    try {
      const waId = await sendTemplateMessage({
        to: phone,
        templateName: campaign.templateName
      });

      campaign.results.push({
        phone,
        status: "sent",
        waMessageId: waId
      });
    } catch (err) {
      campaign.results.push({
        phone,
        status: "failed",
        error: err.message
      });
    }
  }

  campaign.status = "done";
  campaign.updatedAt = new Date().toISOString();
  saveDB(db);

  res.json({
    success: true,
    sent: campaign.results.filter((r) => r.status === "sent").length,
    failed: campaign.results.filter((r) => r.status === "failed").length
  });
});

export default router;
