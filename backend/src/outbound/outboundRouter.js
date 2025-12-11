// backend/src/outbound/templatesRouter.js

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

// Usamos o mesmo data.json do resto da plataforma
const DB_FILE = path.join(process.cwd(), "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err },
      "⚠️ data.json não encontrado ao carregar em templatesRouter, usando objeto vazio."
    );
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json em templatesRouter");
  }
}

/* ============================================================
   TEMPLATES – ESPELHO DA META
   ============================================================ */

/**
 * GET /outbound/templates
 *
 * Retorna a lista de templates salva no data.json.
 * O index.js monta esta rota como:
 *   app.use("/outbound/templates", templatesRouter);
 *
 * Então aqui GET / → GET /outbound/templates no mundo externo.
 */
router.get("/", (req, res) => {
  try {
    const db = loadDB();
    const templates = db.templates || [];
    return res.json(templates);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar templates");
    return res.status(500).json({ error: "Erro ao carregar templates." });
  }
});

/**
 * POST /outbound/templates/sync
 *
 * Consulta o Graph API da Meta e salva os templates em data.json,
 * espelhando a tela de templates da conta WABA.
 */
router.post("/sync", async (req, res) => {
  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      {
        hasWaba: !!WABA_ID,
        hasToken: !!WHATSAPP_TOKEN
      },
      "⚠️ Sync de templates chamado sem WABA_ID/WHATSAPP_TOKEN corretos."
    );

    return res.status(500).json({
      error:
        "WABA_ID/WHATSAPP_WABA_ID ou WHATSAPP_TOKEN não configurados nas variáveis de ambiente."
    });
  }

  try {
    // Endpoint oficial de templates da Meta
    const url = new URL(
      `https://graph.facebook.com/v22.0/${WABA_ID}/message_templates`
    );

    // Campos principais para nossa UI
    url.searchParams.set(
      "fields",
      [
        "id",
        "name",
        "category",
        "language",
        "status",
        "quality_score",
        "components",
        "rejected_reason",
        "latest_template"
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
        "❌ Erro ao consultar message_templates na Meta"
      );
      return res.status(502).json({
        error: "Falha ao consultar a API do WhatsApp (Meta) para templates.",
        details: graphJson
      });
    }

    const now = new Date().toISOString();

    const templates = (graphJson.data || []).map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      category: tpl.category || null,
      language: tpl.language || null,
      status: tpl.status || null,
      quality:
        tpl.quality_score && tpl.quality_score.quality_score
          ? tpl.quality_score.quality_score
          : null,
      hasFlow: Array.isArray(tpl.components)
        ? tpl.components.some(
            (c) =>
              c.type === "BUTTONS" &&
              Array.isArray(c.buttons) &&
              c.buttons.some(
                (b) =>
                  b.type === "FLOW" ||
                  b.button_type === "FLOW" ||
                  b.flow_id
              )
          )
        : false,
      components: tpl.components || [],
      latestVersion: tpl.latest_template || null,
      rejectedReason: tpl.rejected_reason || null,
      updatedAt: now,
      raw: tpl
    }));

    const db = loadDB();
    db.templates = templates;
    saveDB(db);

    logger.info(
      { count: templates.length },
      "✅ Templates sincronizados com sucesso"
    );

    return res.json({
      success: true,
      count: templates.length,
      templates
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado ao sincronizar templates");
    return res
      .status(500)
      .json({ error: "Erro interno ao sincronizar templates." });
  }
});

export default router;
