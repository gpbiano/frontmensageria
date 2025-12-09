// backend/src/outbound/outboundRouter.js
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WHATSAPP_WABA_ID = process.env.WHATSAPP_WABA_ID;

const DB_FILE = path.join(process.cwd(), "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("⚠️ data.json não encontrado, criando novo arquivo.");
    return {};
  }
}

function saveDB(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ============================================================
   CAMPANHAS – ENVIO DE TEMPLATE
   ============================================================ */

router.post("/campaigns", async (req, res) => {
  try {
    const { name, template, parameters, targets, description } = req.body;

    if (!template || !targets || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: "Dados insuficientes." });
    }

    const db = loadDB();
    if (!db.campaigns) db.campaigns = [];

    const campaignId = db.campaigns.length + 1;

    const results = [];
    for (const phone of targets) {
      const payload = {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: template,
          language: { code: "pt_BR" },
          components:
            parameters && parameters.length > 0
              ? [
                  {
                    type: "body",
                    parameters: parameters.map((p) => ({
                      type: "text",
                      text: p,
                    })),
                  },
                ]
              : [],
        },
      };

      const response = await fetch(
        `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();
      results.push({ phone, result });
    }

    db.campaigns.push({
      id: campaignId,
      name,
      template,
      parameters,
      targets,
      description,
      results,
      totalTargets: targets.length,
      createdAt: new Date().toISOString(),
    });

    saveDB(db);

    return res.json({
      success: true,
      id: campaignId,
      totalTargets: targets.length,
      results,
    });
  } catch (err) {
    console.error("❌ Erro inesperado em /outbound/campaigns", err);
    return res
      .status(500)
      .json({ error: "Erro interno ao enviar campanha." });
  }
});

/* ============================================================
   NÚMEROS – ESPELHO DA META
   ============================================================ */

/**
 * GET /outbound/numbers
 * Lê os números salvos em data.json (db.numbers).
 */
router.get("/numbers", (req, res) => {
  try {
    const db = loadDB();
    const numbers = db.numbers || [];
    return res.json(numbers);
  } catch (err) {
    console.error("❌ Erro ao carregar números", err);
    return res.status(500).json({ error: "Erro ao carregar números." });
  }
});

/**
 * POST /outbound/numbers/sync
 * Consulta o Graph API da Meta e salva os números em data.json,
 * espelhando a tela de phone numbers.
 */
router.post("/numbers/sync", async (req, res) => {
  if (!WHATSAPP_WABA_ID || !WHATSAPP_TOKEN) {
    return res.status(500).json({
      error:
        "WHATSAPP_WABA_ID ou WHATSAPP_TOKEN não configurados nas variáveis de ambiente.",
    });
  }

  try {
    const url = new URL(
      `https://graph.facebook.com/v22.0/${WHATSAPP_WABA_ID}/phone_numbers`
    );
    url.searchParams.set(
      "fields",
      [
        "id",
        "display_phone_number",
        "verified_name",
        "quality_rating",
        "code_verification_status",
        "messaging_limit_tier",
        "name_status",
      ].join(",")
    );

    const graphRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      },
    });

    const graphJson = await graphRes.json();

    if (!graphRes.ok) {
      console.error(
        "❌ Erro ao consultar phone_numbers na Meta",
        graphRes.status,
        graphJson
      );
      return res.status(502).json({
        error: "Falha ao consultar a API do WhatsApp (Meta).",
        details: graphJson,
      });
    }

    const now = new Date().toISOString();
    const numbers = (graphJson.data || []).map((n) => ({
      id: n.id,
      name: n.verified_name || n.display_phone_number,
      channel: "WhatsApp",
      number: n.display_phone_number,
      displayPhoneNumber: n.display_phone_number,
      quality: n.quality_rating || "UNKNOWN",
      limit: n.messaging_limit_tier || null,
      status: n.code_verification_status || n.name_status || "UNKNOWN",
      raw: n,
      lastSyncAt: now,
    }));

    const db = loadDB();
    db.numbers = numbers;
    saveDB(db);

    console.log("✅ Números sincronizados com sucesso:", numbers.length);

    return res.json({
      success: true,
      count: numbers.length,
      numbers,
    });
  } catch (err) {
    console.error("❌ Erro inesperado ao sincronizar números", err);
    return res
      .status(500)
      .json({ error: "Erro interno ao sincronizar números." });
  }
});

export default router;
