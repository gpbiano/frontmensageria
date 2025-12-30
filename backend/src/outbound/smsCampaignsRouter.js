// backend/src/outbound/smsCampaignsRouter.js
// ✅ PRISMA-FIRST (SEM data.json) + ✅ IAGENTE SMS
// Base: /outbound/sms-campaigns

import express from "express";
import fetch from "node-fetch";
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

function resolveModel(names) {
  for (const n of names) if (prisma?.[n]) return prisma[n];
  return null;
}

function getDelegateModelName(delegate, fallback = "OutboundCampaign") {
  return delegate?.$name || delegate?._model || delegate?.name || fallback;
}

function modelHasField(modelName, field) {
  try {
    const m = prisma?._dmmf?.datamodel?.models?.find((x) => x.name === modelName);
    return !!m?.fields?.some((f) => f.name === field);
  } catch {
    return true; // fail-open (melhor do que quebrar prod)
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
    res.status(503).json({
      ok: false,
      error: "prisma_model_missing",
      details: { expectedAnyOf: candidates }
    });
    return false;
  }
  return true;
}

// ===== IAGENTE ENV =====
function getIagenteEnv() {
  const user = String(process.env.IAGENTE_SMS_USER || "").trim();
  const pass = String(process.env.IAGENTE_SMS_PASS || "").trim();
  const baseUrl = String(process.env.IAGENTE_SMS_BASE_URL || "").trim();
  return { user, pass, baseUrl };
}

function assertIagenteEnv(res) {
  const { user, pass, baseUrl } = getIagenteEnv();
  if (!user || !pass || !baseUrl) {
    res.status(500).json({
      ok: false,
      error: "missing_iagente_env",
      details:
        "Defina IAGENTE_SMS_USER, IAGENTE_SMS_PASS e IAGENTE_SMS_BASE_URL no backend."
    });
    return false;
  }
  return true;
}

/**
 * Envia SMS pela IAGENTE.
 * Observação: a IAGENTE costuma aceitar tanto GET quanto POST com querystring,
 * então usamos URLSearchParams e POST x-www-form-urlencoded (mais compatível).
 *
 * Se sua conta exigir parâmetros diferentes (ex: celular, msg, etc), ajuste o "payload"
 * abaixo para o padrão exato da IAGENTE do seu contrato.
 */
async function sendSmsIagente({ to, message }) {
  const { user, pass, baseUrl } = getIagenteEnv();

  // 📌 Payload mais comum (ajuste se sua doc exigir outros nomes)
  // Alguns provedores usam: usuario/senha, user/pass, login/senha, celular/telefone, msg/mensagem
  const payload = new URLSearchParams();
  payload.set("user", user);
  payload.set("pass", pass);
  payload.set("to", String(to || "").trim());
  payload.set("message", String(message || ""));

  const resp = await fetch(baseUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: payload.toString()
  });

  const text = await resp.text().catch(() => "");
  // tenta interpretar json, mas mantém raw
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { ok: resp.ok, status: resp.status, raw: text, json };
}

const MODEL_CANDIDATES = ["outboundCampaign", "OutboundCampaign", "campaign", "Campaign"];

// ======================================================
// GET /outbound/sms-campaigns
// ======================================================
router.get("/", requireAuth, async (req, res) => {
  const delegate = resolveModel(MODEL_CANDIDATES);
  const modelName = getDelegateModelName(delegate, "OutboundCampaign");

  try {
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const where = {};
    if (modelHasField(modelName, "tenantId")) where.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) where.channel = "sms";

    const items = await delegate.findMany({
      where,
      orderBy: modelHasField(modelName, "createdAt") ? { createdAt: "desc" } : undefined
    });

    return res.json({ ok: true, items });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ smsCampaignsRouter GET / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ======================================================
// POST /outbound/sms-campaigns
// Cria campanha SMS + envia via IAGENTE (MVP: envio imediato)
// ======================================================
router.post("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const delegate = resolveModel(MODEL_CANDIDATES);
  const modelName = getDelegateModelName(delegate, "OutboundCampaign");

  try {
    if (!assertPrisma(res, delegate, MODEL_CANDIDATES)) return;
    if (!assertIagenteEnv(res)) return;

    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ ok: false, error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const message = String(req.body?.message || "");
    const to = String(req.body?.to || req.body?.phone || req.body?.target || "").trim(); // ✅ flexível
    const metadata =
      req.body?.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};

    if (!name) return res.status(400).json({ ok: false, error: "name_required" });
    if (!message.trim()) return res.status(400).json({ ok: false, error: "message_required" });
    if (!to) return res.status(400).json({ ok: false, error: "to_required" });

    // 1) cria campanha no prisma
    const data = {};

    // ✅ essenciais
    if (modelHasField(modelName, "tenantId")) data.tenantId = tenantId;
    if (modelHasField(modelName, "channel")) data.channel = "sms";
    if (modelHasField(modelName, "name")) data.name = name;
    if (modelHasField(modelName, "status")) data.status = "sending";

    // guarda conteúdo no metadata (ou audience/stats se quiser evoluir)
    if (modelHasField(modelName, "metadata")) {
      data.metadata = { ...metadata, message, to, provider: "iagente" };
    }

    const item = await delegate.create({ data });

    // 2) envia via IAGENTE
    const send = await sendSmsIagente({ to, message });

    // 3) atualiza status
    const nextStatus = send.ok ? "done" : "failed";

    try {
      const upd = {};
      if (modelHasField(modelName, "status")) upd.status = nextStatus;
      if (modelHasField(modelName, "stats")) {
        upd.stats = {
          provider: "iagente",
          httpStatus: send.status,
          ok: send.ok,
          at: new Date().toISOString()
        };
      }
      if (modelHasField(modelName, "metadata")) {
        upd.metadata = {
          ...(item?.metadata || {}),
          iagente: { ok: send.ok, status: send.status, json: send.json, raw: send.raw }
        };
      }

      await delegate.update({ where: { id: item.id }, data: upd });
    } catch (e) {
      logger.warn({ err: String(e?.message || e), id: item?.id }, "smsCampaignsRouter: failed to update status/stats");
    }

    if (!send.ok) {
      logger.error({ status: send.status, raw: send.raw, json: send.json }, "❌ IAGENTE SMS send failed");
      // devolve 502 (problema no provedor), mas mantém campanha criada
      return res.status(502).json({
        ok: false,
        error: "iagente_send_failed",
        item,
        provider: { status: send.status, json: send.json, raw: send.raw }
      });
    }

    return res.status(201).json({ ok: true, item: { ...item, status: "done" } });
  } catch (err) {
    logger.error({ err: err?.message || err, body: req.body }, "❌ smsCampaignsRouter POST / failed");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
