// backend/src/outbound/numbersRouter.js
// ✅ PRISMA-FIRST (SEM data.json)
// Base: /outbound/numbers

import express from "express";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
}
function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return true;
  }
}
function getTenantId(req) {
  const tid = req.tenant?.id || req.tenantId || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}
function assertPrisma(res, model, candidates) {
  if (!prisma || typeof prisma.$queryRaw !== "function") {
    res.status(503).json({ ok: false, error: "prisma_not_ready" });
    return false;
  }
  if (!model) {
    res.status(503).json({ ok: false, error: "prisma_model_missing", details: { expectedAnyOf: candidates } });
    return false;
  }
  return true;
}

function normalizeE164(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`; // sempre com +
}

const MODEL_CANDIDATES = ["outboundNumber", "OutboundNumber", "number", "Number"];

// ======================================================
// GET /outbound/numbers
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;

    const items = await model.findMany({
      where,
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/numbers
// ======================================================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { phoneE164, label, provider, isActive, metadata } = req.body || {};
    const normalized = normalizeE164(phoneE164);

    if (!normalized || normalized.length < 8) {
      return res.status(400).json({ ok: false, error: "phoneE164_invalid" });
    }

    const data = {};
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelName, "phoneE164")) data.phoneE164 = normalized;
    if (modelHasField(modelName, "label")) data.label = label ? String(label) : null;
    if (modelHasField(modelName, "provider")) data.provider = provider ? String(provider) : "meta";
    if (modelHasField(modelName, "isActive")) data.isActive = isActive !== undefined ? !!isActive : true;
    if (modelHasField(modelName, "metadata")) data.metadata = metadata ?? undefined;

    const item = await model.create({ data });

    return res.status(201).json({ ok: true, item });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) {
      return res.status(409).json({ ok: false, error: "number_already_exists" });
    }
    logger.error({ err: err?.message || err }, "❌ numbersRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// ✅ POST /outbound/numbers/sync
// (Botão "Sincronizar" no front geralmente chama isso)
// Objetivo: buscar números/canais do WhatsApp conectados no tenant
// e upsert em OutboundNumber
// ======================================================
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const model = resolveModel(MODEL_CANDIDATES);
  const modelName = model ? model._model || model.name || "unknown" : null;

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    // tenta achar configuração do canal whatsapp no DB (nomes comuns)
    const CHANNEL_CFG_CANDIDATES = ["channelConfig", "ChannelConfig", "channelsConfig", "ChannelsConfig"];
    const channelCfg = resolveModel(CHANNEL_CFG_CANDIDATES);
    const channelCfgName = channelCfg ? channelCfg._model || channelCfg.name || "unknown" : null;

    // Se não existir ChannelConfig, ainda assim não quebramos o front: retornamos vazio.
    if (!channelCfg) {
      return res.json({ ok: true, synced: 0, items: [], note: "channel_config_model_missing" });
    }

    // Busca configs do WhatsApp deste tenant
    const whereCfg = {};
    if (modelHasField(channelCfgName, "tenantId")) whereCfg.tenantId = tenantId;
    if (modelHasField(channelCfgName, "channel")) whereCfg.channel = "whatsapp";

    const cfgs = await channelCfg.findMany({
      where: whereCfg,
      orderBy: modelHasField(channelCfgName, "updatedAt") ? { updatedAt: "desc" } : undefined
    });

    // Extrai possíveis números de dentro de metadata/fields variados
    const extracted = [];
    for (const cfg of cfgs) {
      const md = cfg?.metadata || cfg?.data || cfg?.config || null;

      // candidatos comuns (depende do que você salva hoje)
      const fromFields = [
        cfg?.phoneE164,
        cfg?.phoneNumber,
        cfg?.number,
        cfg?.waPhoneE164,
        md?.phoneE164,
        md?.phoneNumber,
        md?.displayPhoneNumber,
        md?.number
      ].filter(Boolean);

      // às vezes vem como array
      const fromArrays = []
        .concat(md?.numbers || [])
        .concat(md?.phoneNumbers || [])
        .concat(md?.whatsappNumbers || []);

      for (const raw of [...fromFields, ...fromArrays]) {
        if (typeof raw === "string" || typeof raw === "number") {
          const n = normalizeE164(String(raw));
          if (n) extracted.push({ phoneE164: n, label: "WhatsApp", provider: "meta" });
        } else if (raw && typeof raw === "object") {
          const n =
            normalizeE164(raw.phoneE164 || raw.phoneNumber || raw.displayPhoneNumber || raw.number || raw.value || "");
          if (n) {
            extracted.push({
              phoneE164: n,
              label: raw.label || raw.name || "WhatsApp",
              provider: raw.provider || "meta",
              metadata: raw
            });
          }
        }
      }
    }

    // de-dup por phoneE164
    const map = new Map();
    for (const it of extracted) map.set(it.phoneE164, it);
    const unique = Array.from(map.values());

    // Upsert (se existir unique por tenantId+phoneE164)
    // Preferimos usar prisma.outboundNumber direto quando existir, pra usar o compound unique padrão
    const hasDirectOutboundNumber = !!prisma?.outboundNumber?.upsert;
    const upserted = [];

    for (const it of unique) {
      const data = {};
      if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
      if (modelHasField(modelName, "phoneE164")) data.phoneE164 = it.phoneE164;
      if (modelHasField(modelName, "label")) data.label = it.label ? String(it.label) : null;
      if (modelHasField(modelName, "provider")) data.provider = it.provider ? String(it.provider) : "meta";
      if (modelHasField(modelName, "isActive")) data.isActive = true;
      if (modelHasField(modelName, "metadata") && it.metadata) data.metadata = it.metadata;

      if (hasDirectOutboundNumber) {
        // tenta nomes comuns de unique composto
        const uniqueNames = [
          "tenantId_phoneE164",
          "tenantId_phone",
          "tenantId_number",
          "tenantId_phoneNumber"
        ];

        let done = false;
        for (const uniq of uniqueNames) {
          try {
            const row = await prisma.outboundNumber.upsert({
              where: { [uniq]: { tenantId, phoneE164: it.phoneE164 } },
              create: data,
              update: data
            });
            upserted.push(row);
            done = true;
            break;
          } catch (_) {
            // tenta próximo nome
          }
        }

        if (!done) {
          // fallback: create e ignora se já existir
          try {
            const row = await prisma.outboundNumber.create({ data });
            upserted.push(row);
          } catch (_) {}
        }
      } else {
        // fallback genérico
        try {
          const row = await model.create({ data });
          upserted.push(row);
        } catch (_) {}
      }
    }

    return res.json({ ok: true, synced: upserted.length, items: upserted });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
