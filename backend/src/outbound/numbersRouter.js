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
  return `+${digits}`;
}

const MODEL_CANDIDATES = ["outboundNumber", "OutboundNumber", "number", "Number"];

// ======================================================
// GET /outbound/numbers
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  const model = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const items = await model.findMany({
      where: { tenantId },
      orderBy: modelHasField("OutboundNumber", "createdAt") ? { createdAt: "desc" } : undefined
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
  const model = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);

  try {
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const { phoneE164, label, provider, isActive, metadata } = req.body || {};
    const normalized = normalizeE164(phoneE164);

    if (!normalized || normalized.length < 8) {
      return res.status(400).json({ ok: false, error: "phoneE164_invalid" });
    }

    const data = {
      tenantId,
      phoneE164: normalized,
      label: label ? String(label) : null,
      provider: provider ? String(provider) : "meta",
      isActive: isActive !== undefined ? !!isActive : true
    };

    if (modelHasField("OutboundNumber", "metadata")) data.metadata = metadata ?? undefined;

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
// POST /outbound/numbers/sync
// ======================================================
router.post("/sync", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const model = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, model, MODEL_CANDIDATES)) return;

    // tenta achar ChannelConfig pra extrair números
    const CHANNEL_CFG_CANDIDATES = ["channelConfig", "ChannelConfig", "channelsConfig", "ChannelsConfig"];
    const channelCfg = resolveModel(CHANNEL_CFG_CANDIDATES);

    if (!channelCfg) {
      return res.json({ ok: true, synced: 0, items: [], note: "channel_config_model_missing" });
    }

    const cfgs = await channelCfg.findMany({
      where: { tenantId, ...(modelHasField("ChannelConfig", "channel") ? { channel: "whatsapp" } : {}) },
      orderBy: modelHasField("ChannelConfig", "updatedAt") ? { updatedAt: "desc" } : undefined
    });

    const extracted = [];
    for (const cfg of cfgs) {
      const md = cfg?.metadata || cfg?.data || cfg?.config || {};

      const rawCandidates = [
        cfg?.phoneE164,
        cfg?.phoneNumber,
        cfg?.number,
        cfg?.waPhoneE164,
        md?.phoneE164,
        md?.phoneNumber,
        md?.displayPhoneNumber,
        md?.number
      ].filter(Boolean);

      const arrays = []
        .concat(md?.numbers || [])
        .concat(md?.phoneNumbers || [])
        .concat(md?.whatsappNumbers || []);

      for (const raw of [...rawCandidates, ...arrays]) {
        if (typeof raw === "string" || typeof raw === "number") {
          const phoneE164 = normalizeE164(String(raw));
          if (phoneE164) extracted.push({ phoneE164, label: "WhatsApp", provider: "meta" });
        } else if (raw && typeof raw === "object") {
          const phoneE164 = normalizeE164(
            raw.phoneE164 || raw.phoneNumber || raw.displayPhoneNumber || raw.number || raw.value || ""
          );
          if (phoneE164) {
            extracted.push({
              phoneE164,
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

    const upserted = [];
    const canUpsert = model === prisma.outboundNumber && typeof prisma.outboundNumber?.upsert === "function";

    for (const it of unique) {
      const create = {
        tenantId,
        phoneE164: it.phoneE164, // 🔥 obrigatório
        label: it.label ? String(it.label) : null,
        provider: it.provider ? String(it.provider) : "meta",
        isActive: true
      };
      if (modelHasField("OutboundNumber", "metadata") && it.metadata) create.metadata = it.metadata;

      const update = { ...create };
      delete update.tenantId;

      try {
        if (canUpsert) {
          // ✅ pelo seu log, o único composto existente é esse:
          const row = await prisma.outboundNumber.upsert({
            where: { tenantId_phoneE164: { tenantId, phoneE164: it.phoneE164 } },
            create,
            update
          });
          upserted.push(row);
        } else if (typeof model.updateMany === "function") {
          const upd = await model.updateMany({ where: { tenantId, phoneE164: it.phoneE164 }, data: update });
          if (upd?.count > 0) {
            // busca item atualizado (best effort)
            const row = await model.findFirst({ where: { tenantId, phoneE164: it.phoneE164 } });
            if (row) upserted.push(row);
          } else {
            const row = await model.create({ data: create });
            upserted.push(row);
          }
        } else {
          const row = await model.create({ data: create });
          upserted.push(row);
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) continue;
        logger.error({ err: msg, phoneE164: it.phoneE164 }, "❌ numbersRouter sync persist failed");
      }
    }

    return res.json({ ok: true, synced: upserted.length, items: upserted });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
