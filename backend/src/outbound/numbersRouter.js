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
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const delegate = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    const items = await delegate.findMany({
      where: { tenantId },
      orderBy: modelHasField("OutboundNumber", "createdAt") ? { createdAt: "desc" } : undefined
    });

    // ✅ Compat: items + numbers
    return res.json({ ok: true, items, numbers: items, count: items.length });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/numbers
// ======================================================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const delegate = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    const { phoneE164, label, provider, isActive, metadata } = req.body || {};
    const normalized = normalizeE164(phoneE164);

    if (!normalized || normalized.length < 8) {
      return res.status(400).json({ ok: false, error: "phoneE164_invalid" });
    }

    const data = {
      tenantId,
      phoneE164: normalized,
      provider: provider ? String(provider) : "meta",
      isActive: isActive !== undefined ? !!isActive : true
    };

    // ✅ label só se existir no schema
    if (modelHasField("OutboundNumber", "label")) {
      data.label = label ? String(label) : null;
    } else if (modelHasField("OutboundNumber", "metadata")) {
      // fallback: guarda label no metadata
      data.metadata = { ...(metadata || {}), label: label ? String(label) : undefined };
    }

    if (modelHasField("OutboundNumber", "metadata")) {
      // preserva metadata existente (sem sobrescrever label se já colocou acima)
      const base = (typeof data.metadata === "object" && data.metadata) ? data.metadata : {};
      data.metadata = { ...(metadata || {}), ...base };
    }

    const item = await delegate.create({ data });
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

    const delegate = prisma?.outboundNumber || resolveModel(MODEL_CANDIDATES);
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    // tenta achar ChannelConfig pra extrair números
    const CHANNEL_CFG_CANDIDATES = ["channelConfig", "ChannelConfig", "channelsConfig", "ChannelsConfig"];
    const channelCfg = resolveModel(CHANNEL_CFG_CANDIDATES);

    if (!channelCfg) {
      return res.json({ ok: true, synced: 0, items: [], numbers: [], note: "channel_config_model_missing" });
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

    // de-dup
    const map = new Map();
    for (const it of extracted) map.set(it.phoneE164, it);
    const unique = Array.from(map.values());

    const canUpsert =
      delegate === prisma.outboundNumber && typeof prisma.outboundNumber?.upsert === "function";

    const upserted = [];
    const supportsLabel = modelHasField("OutboundNumber", "label");
    const supportsMetadata = modelHasField("OutboundNumber", "metadata");

    for (const it of unique) {
      const create = {
        tenantId,
        phoneE164: it.phoneE164,
        provider: it.provider ? String(it.provider) : "meta",
        isActive: true
      };

      // ✅ label só se existir; senão joga em metadata
      if (supportsLabel) {
        create.label = it.label ? String(it.label) : null;
      } else if (supportsMetadata) {
        create.metadata = { ...(it.metadata || {}), label: it.label ? String(it.label) : undefined };
      } else if (it.metadata) {
        // se nem metadata existir, ignora
      }

      // metadata extra
      if (supportsMetadata) {
        const base = (typeof create.metadata === "object" && create.metadata) ? create.metadata : {};
        create.metadata = { ...(it.metadata || {}), ...base };
      }

      const updateData = { ...create };
      delete updateData.tenantId; // não atualiza tenantId

      try {
        if (canUpsert) {
          const row = await prisma.outboundNumber.upsert({
            where: { tenantId_phoneE164: { tenantId, phoneE164: it.phoneE164 } },
            create,
            update: updateData
          });
          upserted.push(row);
        } else if (typeof delegate.updateMany === "function") {
          const upd = await delegate.updateMany({
            where: { tenantId, phoneE164: it.phoneE164 },
            data: updateData
          });
          if (upd?.count > 0) {
            const row = await delegate.findFirst({ where: { tenantId, phoneE164: it.phoneE164 } });
            if (row) upserted.push(row);
          } else {
            const row = await delegate.create({ data: create });
            upserted.push(row);
          }
        } else {
          const row = await delegate.create({ data: create });
          upserted.push(row);
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (msg.includes("P2002") || msg.toLowerCase().includes("unique")) continue;
        logger.error({ err: msg, phoneE164: it.phoneE164 }, "❌ numbersRouter sync persist failed");
      }
    }

    return res.json({ ok: true, synced: upserted.length, items: upserted, numbers: upserted });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ numbersRouter POST /sync failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
