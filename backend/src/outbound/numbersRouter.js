// backend/src/outbound/numbersRouter.js
import express from "express";
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../logger.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Compatibilidade: aceita tanto WABA_ID quanto WHATSAPP_WABA_ID
const WABA_ID = process.env.WABA_ID || process.env.WHATSAPP_WABA_ID;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

const DB_FILE = path.join(process.cwd(), "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err },
      "⚠️ data.json não encontrado ao carregar em numbersRouter, usando objeto vazio."
    );
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json em numbersRouter");
  }
}

/* ============================================================
   NÚMEROS – ESPELHO DA META
   ============================================================ */

/**
 * GET /outbound/numbers
 * (montado no index.js como app.use("/outbound/numbers", numbersRouter);)
 *
 * Aqui a rota real é GET /  → lista números salvos em data.json.
 */
router.get("/", (req, res) => {
  try {
    const db = loadDB();
    const numbers = db.numbers || [];
    return res.json(numbers);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar números");
    return res.status(500).json({ error: "Erro ao carregar números." });
  }
});

/**
 * POST /outbound/numbers/sync
 *
 * Consulta o Graph API da Meta e salva os números em data.json,
 * espelhando a tela de phone numbers.
 */
router.post("/sync", async (req, res) => {
  if (!WABA_ID || !WHATSAPP_TOKEN) {
    return res.status(500).json({
      error:
        "WABA_ID/WHATSAPP_WABA_ID ou WHATSAPP_TOKEN não configurados nas variáveis de ambiente."
    });
  }

  try {
    const url = new URL(
      `https://graph.facebook.com/v22.0/${WABA_ID}/phone_numbers`
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
        "name_status"
      ].join(",")
    );

    const graphRes = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });

    const graphJson = await graphRes.json();

    if (!graphRes.ok) {
      logger.error(
        { status: graphRes.status, graphJson },
        "❌ Erro ao consultar phone_numbers na Meta"
      );
      return res.status(502).json({
        error: "Falha ao consultar a API do WhatsApp (Meta).",
        details: graphJson
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
      lastSyncAt: now
    }));

    const db = loadDB();
    db.numbers = numbers;
    saveDB(db);

    logger.info(
      { count: numbers.length },
      "✅ Números sincronizados com sucesso"
    );

    return res.json({
      success: true,
      count: numbers.length,
      numbers
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado ao sincronizar números");
    return res
      .status(500)
      .json({ error: "Erro interno ao sincronizar números." });
  }
});

export default router;

