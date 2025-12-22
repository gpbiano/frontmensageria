// backend/src/outbound/numbersRouter.js
import express from "express";
import logger from "../logger.js";
import prisma from "../lib/prisma.js";

const router = express.Router();

/* ============================================================
   HELPERS
============================================================ */

function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId || req.user?.tenantId;
  return tenantId ? String(tenantId) : null;
}

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function toE164Maybe(phoneDisplay) {
  // Meta geralmente já manda com + e DDI. Se vier sem +, a gente normaliza pra dígitos.
  // Melhor guardar no DB como E164 quando possível.
  const s = String(phoneDisplay || "").trim();
  if (!s) return "";
  if (s.startsWith("+")) return s;
  const d = onlyDigits(s);
  return d ? `+${d}` : "";
}

async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

/* ============================================================
   GET /outbound/numbers
============================================================ */

router.get("/", async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const rows = await prisma.outboundNumber.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    // formato compat com o front atual
    const numbers = rows.map((r) => ({
      id: r.id, // no legado era o phone_number_id da Meta; agora é id interno
      metaPhoneNumberId: r.metadata?.phoneNumberId || null, // compat extra
      name: r.label || r.metadata?.verified_name || r.metadata?.display_phone_number || r.phoneE164,
      channel: "WhatsApp",
      number: r.metadata?.display_phone_number || r.phoneE164,
      displayNumber: r.metadata?.display_phone_number || r.phoneE164,
      quality: r.metadata?.quality_rating || "UNKNOWN",
      limitPerDay: r.metadata?.limitPerDay ?? null,
      status: r.metadata?.status || "UNKNOWN",
      connected: Boolean(r.metadata?.connected),
      raw: r.metadata?.raw || null,
      updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null
    }));

    return res.json(numbers);
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar números (Prisma)");
    return res.status(500).json({ error: "Erro ao carregar números." });
  }
});

/* ============================================================
   SYNC (GET/POST) /outbound/numbers/sync
============================================================ */

async function handleSync(req, res) {
  const tenantId = getTenantId(req);
  if (!tenantId) {
    return res.status(400).json({
      success: false,
      error: "tenant_not_resolved",
      numbers: []
    });
  }

  // Lê as variáveis de ambiente na hora da requisição
  const WABA_ID = process.env.WABA_ID || process.env.WHATSAPP_WABA_ID;
  const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;

  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      { WABA_ID: !!WABA_ID, WHATSAPP_TOKEN: !!WHATSAPP_TOKEN },
      "⚠️ Sync chamado sem WABA_ID ou WHATSAPP_TOKEN configurados."
    );

    const rows = await prisma.outboundNumber.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    return res.status(200).json({
      success: false,
      error: "WABA_ID ou WHATSAPP_TOKEN não configurados.",
      numbers: rows
    });
  }

  try {
    const url = new URL(`https://graph.facebook.com/v22.0/${WABA_ID}/phone_numbers`);
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

    logger.info({ url: url.toString(), tenantId }, "🔄 Consultando Meta phone_numbers");

    // 1) chamada Meta
    const fetchFn = await getFetch();

    let graphRes;
    let rawText;

    try {
      graphRes = await fetchFn(url.toString(), {
        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
      });
      rawText = await graphRes.text();
    } catch (err) {
      logger.error({ err }, "❌ Falha de rede ao consultar Meta");
      const rows = await prisma.outboundNumber.findMany({
        where: { tenantId, isActive: true },
        orderBy: { updatedAt: "desc" }
      });

      return res.status(200).json({
        success: false,
        error: "Falha de comunicação com o servidor da Meta.",
        details: err?.message,
        numbers: rows
      });
    }

    // 2) parse JSON
    let graphJson = {};
    try {
      graphJson = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
      logger.error({ err, rawText }, "❌ JSON inválido retornado pela Meta");
      const rows = await prisma.outboundNumber.findMany({
        where: { tenantId, isActive: true },
        orderBy: { updatedAt: "desc" }
      });

      return res.status(200).json({
        success: false,
        error: "Meta retornou conteúdo inválido.",
        details: err?.message,
        numbers: rows
      });
    }

    // 3) erro HTTP
    if (!graphRes.ok) {
      logger.error({ status: graphRes.status, graphJson }, "❌ Meta retornou erro 4xx/5xx");
      const rows = await prisma.outboundNumber.findMany({
        where: { tenantId, isActive: true },
        orderBy: { updatedAt: "desc" }
      });

      return res.status(200).json({
        success: false,
        error: "Erro ao consultar API da Meta.",
        details: graphJson,
        numbers: rows
      });
    }

    // 4) transformar e persistir no Prisma
    const now = new Date().toISOString();

    const mapped = (graphJson.data || []).map((n) => {
      const tier = n.messaging_limit_tier || null;

      let limitPerDay = null;
      if (tier === "TIER_1") limitPerDay = 1000;
      if (tier === "TIER_2") limitPerDay = 10000;
      if (tier === "TIER_3") limitPerDay = 100000;
      if (tier === "TIER_4") limitPerDay = 250000;

      const status = n.code_verification_status || n.name_status || "UNKNOWN";

      const connected =
        status === "VERIFIED" || status === "APPROVED" || status === "CONNECTED";

      const display = String(n.display_phone_number || "").trim();
      const phoneE164 = toE164Maybe(display) || `+${onlyDigits(display)}`;

      return {
        phoneNumberId: n.id,
        display_phone_number: display,
        verified_name: n.verified_name || null,
        quality_rating: n.quality_rating || "UNKNOWN",
        status,
        connected,
        tier,
        limitPerDay,
        raw: n,
        updatedAt: now,
        phoneE164
      };
    });

    // upsert por tenantId + phoneE164 (unique)
    // guarda metaPhoneNumberId no metadata para relacionar com a Meta
    for (const n of mapped) {
      if (!n.phoneE164) continue;

      await prisma.outboundNumber.upsert({
        where: {
          tenantId_phoneE164: {
            tenantId,
            phoneE164: n.phoneE164
          }
        },
        update: {
          label: n.verified_name || n.display_phone_number || undefined,
          provider: "meta",
          isActive: true,
          metadata: {
            phoneNumberId: n.phoneNumberId,
            display_phone_number: n.display_phone_number,
            verified_name: n.verified_name,
            quality_rating: n.quality_rating,
            status: n.status,
            connected: n.connected,
            tier: n.tier,
            limitPerDay: n.limitPerDay,
            raw: n.raw,
            updatedAt: n.updatedAt
          }
        },
        create: {
          tenantId,
          phoneE164: n.phoneE164,
          label: n.verified_name || n.display_phone_number || null,
          provider: "meta",
          isActive: true,
          metadata: {
            phoneNumberId: n.phoneNumberId,
            display_phone_number: n.display_phone_number,
            verified_name: n.verified_name,
            quality_rating: n.quality_rating,
            status: n.status,
            connected: n.connected,
            tier: n.tier,
            limitPerDay: n.limitPerDay,
            raw: n.raw,
            updatedAt: n.updatedAt
          }
        }
      });
    }

    // retorna lista atual do DB
    const rows = await prisma.outboundNumber.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    logger.info({ count: rows.length, tenantId }, "✅ Sync de números concluído com sucesso");

    return res.json({
      success: true,
      count: rows.length,
      numbers: rows
    });
  } catch (err) {
    logger.error({ err, message: err?.message, stack: err?.stack }, "❌ Erro inesperado no sync");

    const rows = await prisma.outboundNumber.findMany({
      where: { tenantId, isActive: true },
      orderBy: { updatedAt: "desc" }
    });

    return res.status(200).json({
      success: false,
      error: "Erro interno inesperado.",
      details: err?.message,
      numbers: rows
    });
  }
}

router.get("/sync", handleSync);
router.post("/sync", handleSync);

export default router;
