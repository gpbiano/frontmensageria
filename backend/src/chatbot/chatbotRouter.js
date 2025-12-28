import express from "express";
import prismaMod from "../lib/prisma.js";
import { getChatbotSettingsForAccount } from "./rulesEngine.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * Helpers
 */
function mustTenant(req, res) {
  const tenantId = req?.tenant?.id ? String(req.tenant.id) : "";
  if (!tenantId) {
    res.status(400).json({ error: "missing_tenant_context" });
    return null;
  }
  return tenantId;
}

function asObj(v) {
  return v && typeof v === "object" ? v : {};
}

function uniqStrings(arr) {
  return Array.from(
    new Set(
      (Array.isArray(arr) ? arr : [])
        .map((s) => String(s || "").trim())
        .filter(Boolean)
    )
  );
}

function readDefaults() {
  // mantém compat com tua engine antiga
  const d = getChatbotSettingsForAccount("default") || {};
  return {
    enabled: d.enabled ?? false,
    maxBotAttempts: Number.isFinite(Number(d.maxBotAttempts)) ? Number(d.maxBotAttempts) : 3,
    transferKeywords: Array.isArray(d.transferKeywords) ? d.transferKeywords : ["humano", "atendente"]
  };
}

/**
 * Lê config do tenant em ChannelConfig(channel="webchat")
 * Armazenamos no JSON config:
 * {
 *   botEnabled: boolean,
 *   maxBotAttempts: number,
 *   transferKeywords: string[],
 *   ...
 * }
 */
async function getWebchatChannelConfig(tenantId) {
  const row = await prisma.channelConfig.findFirst({
    where: { tenantId, channel: "webchat" },
    select: { id: true, enabled: true, widgetKey: true, config: true }
  });

  const defaults = readDefaults();

  if (!row) {
    // ainda não existe row: devolve defaults + botEnabled como defaults.enabled
    return {
      exists: false,
      rowId: null,
      enabled: true,
      widgetKey: "",
      config: {
        botEnabled: defaults.enabled,
        maxBotAttempts: defaults.maxBotAttempts,
        transferKeywords: defaults.transferKeywords
      }
    };
  }

  const cfg = asObj(row.config);
  return {
    exists: true,
    rowId: row.id,
    enabled: row.enabled !== false,
    widgetKey: String(row.widgetKey || ""),
    config: {
      // botEnabled (fonte de verdade do webchat.js)
      botEnabled: cfg.botEnabled === true,

      // extras (usados pelo botEngine / handoff regras)
      maxBotAttempts:
        Number.isFinite(Number(cfg.maxBotAttempts)) && Number(cfg.maxBotAttempts) > 0
          ? Number(cfg.maxBotAttempts)
          : defaults.maxBotAttempts,

      transferKeywords:
        Array.isArray(cfg.transferKeywords) && cfg.transferKeywords.length
          ? cfg.transferKeywords
          : defaults.transferKeywords,

      // preserva qualquer outra coisa já existente
      ...cfg
    }
  };
}

/**
 * GET /api/chatbot/settings
 * Retorna configurações efetivas (fonte: ChannelConfig do tenant + defaults)
 */
router.get("/chatbot/settings", async (req, res) => {
  try {
    const tenantId = mustTenant(req, res);
    if (!tenantId) return;

    const data = await getWebchatChannelConfig(tenantId);

    return res.json({
      ok: true,
      tenantId,
      channel: "webchat",
      enabled: data.config.botEnabled === true,
      maxBotAttempts: data.config.maxBotAttempts,
      transferKeywords: uniqStrings(data.config.transferKeywords),
      raw: {
        // útil pra debug no painel
        channelConfigExists: data.exists,
        channelConfigEnabled: data.enabled,
        widgetKeyConfigured: !!String(data.widgetKey || "").trim()
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "internal_server_error", detail: String(err?.message || err) });
  }
});

/**
 * PATCH /api/chatbot/settings
 * body: { enabled?: boolean, maxBotAttempts?: number, transferKeywords?: string[] }
 *
 * Atualiza diretamente ChannelConfig.config do tenant (channel="webchat").
 */
router.patch("/chatbot/settings", async (req, res) => {
  try {
    const tenantId = mustTenant(req, res);
    if (!tenantId) return;

    const body = asObj(req.body);

    // lê atual
    const current = await getWebchatChannelConfig(tenantId);
    const nextCfg = asObj(current.config);

    // validações
    if (body.enabled !== undefined) {
      nextCfg.botEnabled = body.enabled === true;
    }

    if (body.maxBotAttempts !== undefined) {
      const n = Number(body.maxBotAttempts);
      if (!Number.isFinite(n) || n < 1 || n > 50) {
        return res.status(400).json({ error: "maxBotAttempts inválido (1..50)" });
      }
      nextCfg.maxBotAttempts = Math.floor(n);
    }

    if (body.transferKeywords !== undefined) {
      if (!Array.isArray(body.transferKeywords)) {
        return res.status(400).json({ error: "transferKeywords deve ser array" });
      }
      nextCfg.transferKeywords = uniqStrings(body.transferKeywords).slice(0, 50);
    }

    // garante row (cria se não existir)
    if (!current.exists) {
      const created = await prisma.channelConfig.create({
        data: {
          tenantId,
          channel: "webchat",
          enabled: true,
          widgetKey: "", // mantém vazio se você não quer setar aqui
          config: nextCfg
        },
        select: { id: true, config: true }
      });

      return res.json({
        ok: true,
        tenantId,
        channel: "webchat",
        updated: {
          enabled: created.config?.botEnabled === true,
          maxBotAttempts: created.config?.maxBotAttempts,
          transferKeywords: created.config?.transferKeywords || []
        }
      });
    }

    const updated = await prisma.channelConfig.update({
      where: { id: current.rowId },
      data: { config: nextCfg },
      select: { id: true, config: true }
    });

    return res.json({
      ok: true,
      tenantId,
      channel: "webchat",
      updated: {
        enabled: updated.config?.botEnabled === true,
        maxBotAttempts: updated.config?.maxBotAttempts,
        transferKeywords: updated.config?.transferKeywords || []
      }
    });
  } catch (err) {
    return res.status(500).json({ error: "internal_server_error", detail: String(err?.message || err) });
  }
});

export default router;
