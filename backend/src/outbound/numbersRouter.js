// backend/src/outbound/numbersRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

// Arquivo local para cache dos números
const NUMBERS_FILE = path.join(process.cwd(), "numbers.json");

// intervalo de auto-atualização (ms)
const AUTO_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutos

// ------------------------
// Helpers de arquivo local
// ------------------------
function loadNumbersFromDisk() {
  try {
    if (!fs.existsSync(NUMBERS_FILE)) {
      return { numbers: [], lastSyncAt: null };
    }

    const raw = fs.readFileSync(NUMBERS_FILE, "utf8");
    if (!raw.trim()) {
      return { numbers: [], lastSyncAt: null };
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.numbers)) {
      return { numbers: [], lastSyncAt: null };
    }

    return {
      numbers: parsed.numbers,
      lastSyncAt: parsed.lastSyncAt || null
    };
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar numbers.json");
    return { numbers: [], lastSyncAt: null };
  }
}

function saveNumbersToDisk(numbers, lastSyncAt = null) {
  try {
    const payload = {
      numbers,
      lastSyncAt: lastSyncAt || new Date().toISOString()
    };

    fs.writeFileSync(NUMBERS_FILE, JSON.stringify(payload, null, 2), "utf8");

    logger.info(
      { count: numbers.length, lastSyncAt: payload.lastSyncAt },
      "💾 Números salvos em numbers.json"
    );
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar numbers.json");
  }
}

// ------------------------
// Helper pra ler env SEMPRE na hora de usar
// ------------------------
function getMetaConfig() {
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
  const WABA_ID = process.env.WABA_ID;

  logger.info(
    { hasToken: !!WHATSAPP_TOKEN, hasWabaId: !!WABA_ID },
    "🔎 Verificando configuração da Meta (numbersRouter)"
  );

  return { WHATSAPP_TOKEN, WABA_ID };
}

// ------------------------
// Função que fala com a Meta
// ------------------------
async function syncNumbersFromMeta() {
  const { WHATSAPP_TOKEN, WABA_ID } = getMetaConfig();

  if (!WHATSAPP_TOKEN || !WABA_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, WABA_ID },
      "❌ WHATSAPP_TOKEN ou WABA_ID ausente."
    );
    throw new Error("Configuração da Meta incompleta");
  }

  const url = `https://graph.facebook.com/v22.0/${WABA_ID}/phone_numbers?fields=id,verified_name,display_phone_number,quality_rating,code_verification_status&limit=1000`;

  logger.info({ url, WABA_ID }, "🔄 Iniciando sincronização de números com a Meta");

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    logger.error(
      { status: res.status, data },
      "❌ Erro ao consultar /phone_numbers na Meta"
    );
    throw new Error("Falha ao consultar números na Meta");
  }

  const items = (data && data.data) || [];

  const normalized = items.map((item) => ({
    id: item.id,
    wabaId: WABA_ID,
    verifiedName: item.verified_name || null,
    displayPhoneNumber: item.display_phone_number || "",
    qualityRating: item.quality_rating || null,
    codeVerificationStatus: item.code_verification_status || null
  }));

  saveNumbersToDisk(normalized);
  logger.info({ count: normalized.length }, "✅ Números sincronizados com sucesso");

  return normalized;
}

// ------------------------
// GET /outbound/numbers
// Auto-sync se o cache for antigo
// ------------------------
router.get("/", async (req, res, next) => {
  try {
    let { numbers, lastSyncAt } = loadNumbersFromDisk();

    const now = Date.now();
    const lastSyncTime = lastSyncAt ? Date.parse(lastSyncAt) : 0;
    const diff = now - lastSyncTime;

    // Se nunca sincronizou ou passou do intervalo, sincroniza automaticamente
    if (!lastSyncAt || diff > AUTO_SYNC_INTERVAL_MS) {
      try {
        const synced = await syncNumbersFromMeta();
        numbers = synced;
        lastSyncAt = new Date().toISOString();
      } catch (err) {
        // Se der erro na Meta, só loga e devolve o cache antigo
        logger.error({ err }, "⚠️ Erro no auto-sync, devolvendo cache local");
      }
    }

    res.json({
      numbers,
      lastSyncAt
    });
  } catch (err) {
    next(err);
  }
});

// ------------------------
// POST /outbound/numbers/sync
// Força sincronização manual (botão “Sincronizar com a Meta”)
// ------------------------
router.post("/sync", async (req, res, next) => {
  try {
    const { WHATSAPP_TOKEN, WABA_ID } = getMetaConfig();
    if (!WHATSAPP_TOKEN || !WABA_ID) {
      return res.status(400).json({
        ok: false,
        error:
          "Configuração da Meta incompleta. Verifique WHATSAPP_TOKEN e WABA_ID no .env do backend."
      });
    }

    const numbers = await syncNumbersFromMeta();
    res.json({
      ok: true,
      count: numbers.length
    });
  } catch (err) {
    next(err);
  }
});

export default router;

