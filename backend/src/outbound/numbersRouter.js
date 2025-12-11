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

// Caminho do data.json
const DB_FILE = path.join(process.cwd(), "data.json");

/* ============================================================
   CARREGAR E SALVAR DB
============================================================ */

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn({ err }, "⚠️ data.json não encontrado — usando objeto vazio.");
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json");
  }
}

/* ============================================================
   GET /outbound/numbers
============================================================ */

router.get("/", (req, res) => {
  try {
    const db = loadDB();
    return res.json(db.numbers || []);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar números");
    return res.status(500).json({ error: "Erro ao carregar números." });
  }
});

/* ============================================================
   FUNÇÃO DE SYNC → usada por GET e POST
   (lê as ENV *dentro* da função!)
============================================================ */

async function handleSync(req, res) {
  // Lê as variáveis de ambiente na hora da requisição
  const WABA_ID = process.env.WABA_ID || process.env.WHATSAPP_WABA_ID;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      {
        WABA_ID: !!WABA_ID,
        WHATSAPP_TOKEN: !!WHATSAPP_TOKEN
      },
      "⚠️ Sync chamado sem WABA_ID ou WHATSAPP_TOKEN configurados."
    );

    return res.status(200).json({
      success: false,
      error: "WABA_ID ou WHATSAPP_TOKEN não configurados.",
      numbers: loadDB().numbers || []
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

    logger.info({ url: url.toString() }, "🔄 Consultando Meta phone_numbers");

    /* -------------------------------------------
       1) CHAMADA À META
    -------------------------------------------- */
    let graphRes;
    let rawText;

    try {
      graphRes = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${WHATSAPP_TOKEN}`
        }
      });
      rawText = await graphRes.text();
    } catch (err) {
      logger.error({ err }, "❌ Falha de rede ao consultar Meta");

      return res.status(200).json({
        success: false,
        error: "Falha de comunicação com o servidor da Meta.",
        details: err?.message,
        numbers: loadDB().numbers || []
      });
    }

    /* -------------------------------------------
       2) PARSE DO JSON
    -------------------------------------------- */
    let graphJson = {};
    try {
      graphJson = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
      logger.error(
        { err, rawText },
        "❌ JSON inválido retornado pela Meta"
      );

      return res.status(200).json({
        success: false,
        error: "Meta retornou conteúdo inválido.",
        details: err?.message,
        numbers: loadDB().numbers || []
      });
    }

    /* -------------------------------------------
       3) META RESPONDEU ERRO HTTP
    -------------------------------------------- */
    if (!graphRes.ok) {
      logger.error(
        { status: graphRes.status, graphJson },
        "❌ Meta retornou erro 4xx/5xx"
      );

      return res.status(200).json({
        success: false,
        error: "Erro ao consultar API da Meta.",
        details: graphJson,
        numbers: loadDB().numbers || []
      });
    }

    /* -------------------------------------------
       4) TRANSFORMAR PARA O FORMATO DO FRONT
    -------------------------------------------- */
    const now = new Date().toISOString();

    const numbers = (graphJson.data || []).map((n) => {
      const tier = n.messaging_limit_tier || null;

      let limitPerDay = null;
      if (tier === "TIER_1") limitPerDay = 1000;
      if (tier === "TIER_2") limitPerDay = 10000;
      if (tier === "TIER_3") limitPerDay = 100000;
      if (tier === "TIER_4") limitPerDay = 250000;

      const status =
        n.code_verification_status || n.name_status || "UNKNOWN";

      const connected =
        status === "VERIFIED" ||
        status === "APPROVED" ||
        status === "CONNECTED";

      return {
        id: n.id,
        name: n.verified_name || n.display_phone_number,
        channel: "WhatsApp",
        number: n.display_phone_number,
        displayNumber: n.display_phone_number,
        quality: n.quality_rating || "UNKNOWN",
        limitPerDay,
        status,
        connected,
        raw: n,
        updatedAt: now
      };
    });

    const db = loadDB();
    db.numbers = numbers;
    saveDB(db);

    logger.info(
      { count: numbers.length },
      "✅ Sync de números concluído com sucesso"
    );

    return res.json({
      success: true,
      count: numbers.length,
      numbers
    });
  } catch (err) {
    logger.error(
      { err, message: err?.message, stack: err?.stack },
      "❌ Erro inesperado no sync"
    );

    return res.status(200).json({
      success: false,
      error: "Erro interno inesperado.",
      details: err?.message,
      numbers: loadDB().numbers || []
    });
  }
}

/* ============================================================
   ACEITAR GET e POST para /sync
============================================================ */

router.get("/sync", handleSync);
router.post("/sync", handleSync);

/* ============================================================
   EXPORT DEFAULT
============================================================ */

export default router;
