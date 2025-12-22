// backend/src/outbound/campaignEngine.js
import logger from "../logger.js";
import prisma from "../lib/prisma.js";

/**
 * ============================================================
 * FETCH (Node18+ tem global fetch; fallback node-fetch)
 * ============================================================
 */
async function getFetch() {
  if (globalThis.fetch) return globalThis.fetch;
  const mod = await import("node-fetch");
  return mod.default;
}

/**
 * ============================================================
 * WhatsApp ENV por tenant (ChannelConfig) + fallback ENV
 * channel: "whatsapp"
 * config JSON esperado:
 *  { "token":"...", "phoneNumberId":"...", "apiVersion":"v22.0" }
 * ============================================================
 */
function normalizeApiVersion(v) {
  const s = String(v || "").trim();
  if (!s) return "v22.0";
  return s.startsWith("v") ? s : `v${s}`;
}

async function getWhatsAppEnvForTenant(tenantId) {
  let token = "";
  let phoneNumberId = "";
  let apiVersion = "v22.0";

  // Preferencial: ChannelConfig por tenant
  try {
    if (tenantId) {
      const row = await prisma.channelConfig.findFirst({
        where: { tenantId, channel: "whatsapp" },
        select: { config: true }
      });

      const cfg = row?.config && typeof row.config === "object" ? row.config : {};

      token = String(cfg.token || cfg.WHATSAPP_TOKEN || "").trim();
      phoneNumberId = String(
        cfg.phoneNumberId || cfg.PHONE_NUMBER_ID || cfg.WHATSAPP_PHONE_NUMBER_ID || ""
      ).trim();
      apiVersion = normalizeApiVersion(cfg.apiVersion || cfg.WHATSAPP_API_VERSION || apiVersion);
    }
  } catch (e) {
    logger.warn({ e }, "campaignEngine: falha ao ler ChannelConfig, usando ENV");
  }

  // Fallback ENV (não trava const no topo!)
  if (!token) token = String(process.env.WHATSAPP_TOKEN || "").trim();
  if (!phoneNumberId) {
    phoneNumberId = String(
      process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID || ""
    ).trim();
  }
  apiVersion = normalizeApiVersion(process.env.WHATSAPP_API_VERSION || apiVersion);

  return { token, phoneNumberId, apiVersion };
}

async function assertWhatsAppConfigured(tenantId) {
  const { token, phoneNumberId, apiVersion } = await getWhatsAppEnvForTenant(tenantId);
  if (!token || !phoneNumberId) {
    throw new Error(
      "WhatsApp não configurado. Cadastre token/phoneNumberId em ChannelConfig(channel=whatsapp) ou defina WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID."
    );
  }
  return { token, phoneNumberId, apiVersion };
}

/**
 * ============================================================
 * HELPERS
 * ============================================================
 */
function nowIso() {
  return new Date().toISOString();
}

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function normalizeMetaError(err) {
  if (!err) return null;
  const e = err?.error ? err.error : err;
  return {
    code: e?.code ?? e?.error_code ?? e?.errorCode ?? null,
    message: e?.message ?? e?.error_user_msg ?? e?.errorMessage ?? null,
    type: e?.type ?? null,
    subcode: e?.error_subcode ?? e?.subcode ?? null,
    trace: e?.fbtrace_id ?? null
  };
}

function coerceTargets(targets) {
  if (!targets) return [];
  if (Array.isArray(targets)) return targets.map((t) => String(t || "").trim()).filter(Boolean);
  return [];
}

/**
 * ============================================================
 * WHATSAPP SEND
 * ============================================================
 */
async function sendTemplateMessage({
  tenantId,
  to,
  templateName,
  languageCode = "pt_BR",
  bodyVars = []
}) {
  const { token, phoneNumberId, apiVersion } = await assertWhatsAppConfigured(tenantId);

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const components = [];
  if (Array.isArray(bodyVars) && bodyVars.length > 0) {
    components.push({
      type: "body",
      parameters: bodyVars.map((v) => ({ type: "text", text: String(v) }))
    });
  }

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length ? { components } : {})
    }
  };

  const fetchFn = await getFetch();
  const resp = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await resp.text().catch(() => "");
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = {};
  }

  if (!resp.ok) {
    const msg = data?.error?.message || data?.message || `Erro WhatsApp (${resp.status})`;
    const err = new Error(msg);
    err.meta = data?.error || data || null;
    err.httpStatus = resp.status;
    throw err;
  }

  return data;
}

/**
 * ============================================================
 * ✅ API PRINCIPAL (PRISMA-FIRST, SEM data.json)
 *
 * Mantém compatibilidade com chamada antiga:
 * sendTemplateCampaign({
 *   name,
 *   template,
 *   parameters,
 *   targets,
 *   description
 * })
 *
 * Mas AGORA exige tenantId (multi-tenant) ou vai tentar inferir de forma insegura.
 * Recomendo sempre passar tenantId.
 *
 * Retorno (compat):
 * {
 *   campaignId,
 *   totalTargets,
 *   results,
 *   campaign
 * }
 * ============================================================
 */
export async function sendTemplateCampaign({
  // ✅ NOVO (recomendado)
  tenantId,
  numberId = null, // opcional (informativo)
  templateLanguage = "pt_BR",

  // ✅ COMPAT LEGACY
  name,
  template, // templateName
  parameters, // body vars iguais para todos
  targets, // array phones

  // ✅ extras
  description
}) {
  const tid = tenantId ? String(tenantId) : null;
  if (!tid) {
    throw new Error("tenantId é obrigatório no campaignEngine (multi-tenant).");
  }

  const templateName = String(template || "").trim();
  const targetPhones = coerceTargets(targets);

  if (!templateName || targetPhones.length === 0) {
    throw new Error("Dados insuficientes para campanha (template/targets).");
  }

  // valida WhatsApp config ANTES de criar campanha
  await assertWhatsAppConfigured(tid);

  const createdAt = nowIso();

  // cria campanha no prisma (OutboundCampaign)
  const campaignRow = await prisma.outboundCampaign.create({
    data: {
      id: `cmp_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      tenantId: tid,
      name: String(name || `Campanha ${createdAt}`),
      numberId: String(numberId || "whatsapp"),
      templateName,
      templateLanguage: String(templateLanguage || "pt_BR"),
      excludeOptOut: false,
      status: "sending",
      audience: {
        description: description ? String(description) : "",
        totalTargets: targetPhones.length
      },
      audienceRows: targetPhones.map((phone) => ({
        phone,
        vars: Array.isArray(parameters) ? parameters.map((p) => String(p ?? "")) : []
      })),
      results: [],
      logs: [
        { at: createdAt, type: "created", message: "Campanha criada (engine)" },
        {
          at: createdAt,
          type: "start_requested",
          message: `Início solicitado (${targetPhones.length} destinatários)`
        }
      ],
      timeline: { startedAt: createdAt }
    }
  });

  logger.info(
    { campaignId: campaignRow.id, name: campaignRow.name, templateName, totalTargets: targetPhones.length },
    "📣 Iniciando envio de campanha (Prisma)"
  );

  const results = [];
  let sent = 0;
  let failed = 0;

  for (const phone of targetPhones) {
    try {
      const data = await sendTemplateMessage({
        tenantId: tid,
        to: phone,
        templateName,
        languageCode: String(templateLanguage || "pt_BR"),
        bodyVars: Array.isArray(parameters) ? parameters : []
      });

      const waMessageId = data?.messages?.[0]?.id || null;

      results.push({
        phone,
        status: "sent",
        waMessageId,
        updatedAt: nowIso()
      });

      sent++;
      logger.info({ phone, waMessageId, campaignId: campaignRow.id }, "📤 Template enviado (engine)");
    } catch (err) {
      const metaErr = normalizeMetaError(err?.meta || null);
      const msg = metaErr?.message || err?.message || "Falha ao enviar";

      results.push({
        phone,
        status: "failed",
        updatedAt: nowIso(),
        error: msg,
        metaError: metaErr
      });

      failed++;
      logger.error(
        { phone, campaignId: campaignRow.id, err: err?.message, metaErr },
        "❌ Falha ao enviar template (engine)"
      );
    }
  }

  const finishedAt = nowIso();
  const finalStatus = failed > 0 && sent === 0 ? "failed" : "done";

  const finalLogs = [
    ...(Array.isArray(campaignRow.logs) ? campaignRow.logs : []),
    { at: finishedAt, type: "finished", message: `Finalizada: ${sent} enviados, ${failed} falhas` }
  ];

  const updated = await prisma.outboundCampaign.update({
    where: { id: campaignRow.id },
    data: {
      status: finalStatus,
      results,
      logs: finalLogs,
      timeline: { ...(campaignRow.timeline || {}), finishedAt }
    }
  });

  logger.info(
    { campaignId: updated.id, totalTargets: targetPhones.length, sent, failed, status: finalStatus },
    "✅ Campanha concluída (Prisma)"
  );

  // retorno compat com versão antiga
  return {
    campaignId: updated.id,
    totalTargets: targetPhones.length,
    results: results.map((r) => ({
      phone: r.phone,
      result: r.status === "sent" ? { messages: [{ id: r.waMessageId }] } : { error: r.error, metaError: r.metaError },
      ok: safeLower(r.status) !== "failed"
    })),
    campaign: updated
  };
}
