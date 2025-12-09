// backend/src/outbound/templatesRouter.js

import express from "express";
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

// Arquivo de cache local de templates
const TEMPLATES_FILE = path.join(process.cwd(), "templates.json");

// ===============================
// ENV – META
// ===============================
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WABA_ID = process.env.WABA_ID;

// ===============================
// HELPERS – ARQUIVO LOCAL
// ===============================
function loadTemplatesCache() {
  try {
    if (!fs.existsSync(TEMPLATES_FILE)) {
      const initial = { templates: [] };
      fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(TEMPLATES_FILE, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.templates)) {
      return { templates: [] };
    }
    return data;
  } catch (err) {
    logger.error({ err }, "❌ Erro ao carregar templates.json");
    return { templates: [] };
  }
}

function saveTemplatesCache(cache) {
  try {
    fs.writeFileSync(
      TEMPLATES_FILE,
      JSON.stringify(cache, null, 2),
      "utf8"
    );
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar templates.json");
  }
}

// formata uma data simples só pra exibição
function formatDate(dateStr) {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleDateString("pt-BR");
  } catch {
    return "-";
  }
}

// ===============================
// HELPERS – META / GRAPH API
// ===============================
async function fetchTemplatesFromMeta() {
  if (!WHATSAPP_TOKEN || !WABA_ID) {
    logger.error(
      { hasToken: !!WHATSAPP_TOKEN, hasWaba: !!WABA_ID },
      "❌ WHATSAPP_TOKEN ou WABA_ID ausente (templates)."
    );
    throw new Error("Configuração da Meta incompleta");
  }

  const url = `https://graph.facebook.com/v22.0/${WABA_ID}/message_templates?access_token=${WHATSAPP_TOKEN}&limit=200`;

  logger.info({ url }, "🌐 Buscando templates na Meta");

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    logger.error(
      { status: res.status, data },
      "❌ Erro ao buscar templates na Meta"
    );
    throw new Error("Erro ao buscar templates na Meta");
  }

  const rawTemplates = Array.isArray(data.data) ? data.data : [];

  const mapped = rawTemplates.map((t) => {
    // Meta retorna category, name, language, status, components, etc.
    const category = t.category || "UNKNOWN";
    const language = t.language || "pt_BR";
    const status = t.status || "UNKNOWN";

    // tentar inferir tipo de visualização
    let previewType = "text";
    if (Array.isArray(t.components)) {
      const hasButtons = t.components.some((c) => c.type === "BUTTONS");
      if (hasButtons) previewType = "text_button";
    }

    return {
      id: t.id || t.name,
      source: "META",
      name: t.name,
      channel: "WhatsApp",
      category: category.toLowerCase(), // marketing / utility / authentication
      categoryLabel: category.toUpperCase(),
      language,
      languageLabel: language,
      previewType,
      previewTypeLabel:
        previewType === "text_button" ? "Texto + botão" : "Texto",
      status: status.toUpperCase(), // APPROVED / PENDING / REJECTED / ...
      statusLabel: status.toUpperCase(),
      createdAt: t.creation_time || null,
      createdAtFormatted: formatDate(t.creation_time)
    };
  });

  logger.info(
    { count: mapped.length },
    "✅ Templates carregados da Meta com sucesso"
  );

  return mapped;
}

/**
 * Faz sync com a Meta e atualiza o cache,
 * preservando templates locais.
 */
async function syncTemplatesFromMeta() {
  const cache = loadTemplatesCache();
  const localTemplates = (cache.templates || []).filter(
    (tpl) => tpl.source === "LOCAL"
  );

  const metaTemplates = await fetchTemplatesFromMeta();

  const merged = [...localTemplates, ...metaTemplates];

  const newCache = { templates: merged };
  saveTemplatesCache(newCache);

  return merged;
}

// ===============================
// ROTAS
// ===============================

/**
 * GET /outbound/templates
 * - Tenta sincronizar automaticamente com a Meta
 * - Se der erro (falta de credencial), devolve só o cache local
 */
router.get("/templates", async (req, res) => {
  try {
    let templates;

    try {
      templates = await syncTemplatesFromMeta();
    } catch (err) {
      logger.error(
        { err },
        "⚠️ Erro no auto-sync de templates, devolvendo cache local"
      );
      const cache = loadTemplatesCache();
      templates = cache.templates || [];
    }

    res.json({ templates });
  } catch (err) {
    logger.error({ err }, "❌ Erro em GET /outbound/templates");
    res.status(500).json({ error: "Erro ao listar templates" });
  }
});

/**
 * POST /outbound/templates
 * Cria um template local (rascunho) na plataforma.
 * Ainda NÃO envia para a Meta (por enquanto).
 */
router.post("/templates", (req, res) => {
  try {
    const {
      name,
      channel = "whatsapp",
      category = "marketing",
      language = "pt_BR",
      previewType = "text",
      body,
      footer,
      buttonsType = "none",
      buttons = {}
    } = req.body || {};

    if (!name || !name.trim()) {
      return res.status(400).json({
        error: "Nome do template é obrigatório."
      });
    }

    if (!body || !body.trim()) {
      return res.status(400).json({
        error: "Corpo da mensagem é obrigatório."
      });
    }

    const cache = loadTemplatesCache();
    const templates = cache.templates || [];

    // id local único
    const id = `local-${Date.now()}`;

    const now = new Date().toISOString();

    const tpl = {
      id,
      source: "LOCAL",
      name: name.trim(),
      channel: channel || "whatsapp",
      category,
      categoryLabel:
        category === "marketing"
          ? "MARKETING"
          : category === "utility"
          ? "UTILITY"
          : category === "authentication"
          ? "AUTHENTICATION"
          : String(category).toUpperCase(),
      language,
      languageLabel: language,
      previewType,
      previewTypeLabel:
        previewType === "text_button" ? "Texto + botão" : "Texto",
      body,
      footer: footer || "",
      buttonsType,
      buttons,
      status: "LOCAL_ONLY",
      statusLabel: "Rascunho local",
      createdAt: now,
      createdAtFormatted: formatDate(now)
    };

    templates.push(tpl);
    cache.templates = templates;
    saveTemplatesCache(cache);

    logger.info(
      { id: tpl.id, name: tpl.name },
      "🆕 Template local criado com sucesso"
    );

    return res.status(201).json(tpl);
  } catch (err) {
    logger.error({ err }, "❌ Erro em POST /outbound/templates");
    return res.status(500).json({ error: "Erro ao criar template" });
  }
});

/**
 * POST /outbound/templates/sync
 * Endpoint manual para forçar sync com a Meta (se quiser usar em botão).
 */
router.post("/templates/sync", async (req, res) => {
  try {
    const templates = await syncTemplatesFromMeta();
    res.json({ templates });
  } catch (err) {
    logger.error({ err }, "❌ Erro em POST /outbound/templates/sync");
    res.status(500).json({ error: "Erro ao sincronizar com a Meta" });
  }
});

export default router;

