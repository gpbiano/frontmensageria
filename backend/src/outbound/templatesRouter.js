import express from "express";
import fetch from "node-fetch";
import logger from "../logger.js";

const router = express.Router();

// -------------------------------------------------------------------
// IMPORTANTE: NÃO travar WABA_ID/WHATSAPP_TOKEN em const de topo,
// porque o dotenv só é carregado depois no index.js.
// Vamos sempre ler direto de process.env dentro das funções.
// -------------------------------------------------------------------

// Esse log é só informativo; aqui ainda pode mostrar N/A, e tudo bem.
logger.info(
  {
    WABA_ID: process.env.WABA_ID || "N/A",
    WHATSAPP_TOKEN_len: process.env.WHATSAPP_TOKEN
      ? process.env.WHATSAPP_TOKEN.length
      : "N/A"
  },
  "🔧 TemplatesRouter carregado"
);

// ===============================
// HELPER PARA LER ENV SEMPRE ATUALIZADO
// ===============================
function getEnv() {
  return {
    WABA_ID: process.env.WABA_ID,
    WHATSAPP_TOKEN: process.env.WHATSAPP_TOKEN
  };
}

// ===============================
// VERIFICAÇÃO DE ENV
// ===============================
function ensureEnv(res) {
  const { WABA_ID, WHATSAPP_TOKEN } = getEnv();

  if (!WABA_ID || !WHATSAPP_TOKEN) {
    logger.warn(
      { hasWaba: !!WABA_ID, hasToken: !!WHATSAPP_TOKEN },
      "⚠️ Templates – WABA_ID/WHATSAPP_TOKEN ausentes"
    );

    res.status(500).json({
      error:
        "Configuração do WhatsApp não encontrada. Verifique WABA_ID e WHATSAPP_TOKEN no .env."
    });
    return false;
  }

  return true;
}

// ===============================
// LISTAR TEMPLATES DA META
// ===============================
router.get("/", async (req, res) => {
  if (!ensureEnv(res)) return;
  const { WABA_ID, WHATSAPP_TOKEN } = getEnv();

  try {
    const url = `https://graph.facebook.com/v22.0/${WABA_ID}/message_templates`;

    const metaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    const json = await metaRes.json();

    if (!metaRes.ok) {
      logger.error(
        { status: metaRes.status, json },
        "❌ Erro ao listar templates na Meta"
      );
      return res
        .status(500)
        .json({ error: "Erro ao listar templates", details: json });
    }

    // Em alguns lugares você já converte esse objeto para Template typed no frontend.
    // Aqui retornamos o JSON cru da Meta.
    res.json(json.data || []);
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado ao listar templates");
    res.status(500).json({ error: "Erro interno ao listar templates" });
  }
});

// ===============================
// SINCRONIZAR (MESMO QUE LISTAR, POR ENQUANTO)
// ===============================
router.post("/sync", async (req, res) => {
  if (!ensureEnv(res)) return;
  const { WABA_ID, WHATSAPP_TOKEN } = getEnv();

  try {
    const url = `https://graph.facebook.com/v22.0/${WABA_ID}/message_templates`;

    const metaRes = await fetch(url, {
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
    });

    const json = await metaRes.json();

    if (!metaRes.ok) {
      logger.error(
        { status: metaRes.status, json },
        "❌ Erro ao sincronizar templates"
      );
      return res
        .status(500)
        .json({ error: "Erro ao sincronizar templates", details: json });
    }

    res.json(json.data || []);
  } catch (err) {
    logger.error({ err }, "❌ Erro interno ao sincronizar templates");
    res.status(500).json({ error: "Erro interno ao sincronizar templates" });
  }
});

// ===============================
// CRIAR TEMPLATE
// ===============================
router.post("/", async (req, res) => {
  if (!ensureEnv(res)) return;
  const { WABA_ID, WHATSAPP_TOKEN } = getEnv();

  const payload = req.body;

  logger.info(
    {
      payload,
      WABA_ID,
      WHATSAPP_TOKEN_len: WHATSAPP_TOKEN
        ? WHATSAPP_TOKEN.length
        : "N/A"
    },
    "📨 Recebido pedido de criação de template"
  );

  try {
    const url = `https://graph.facebook.com/v22.0/${WABA_ID}/message_templates`;

    const metaRes = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const json = await metaRes.json();

    if (!metaRes.ok) {
      logger.error(
        {
          status: metaRes.status,
          json
        },
        "❌ Erro ao criar template na Meta"
      );
      return res.status(500).json({
        error: "Erro ao criar template",
        details: json
      });
    }

    logger.info({ json }, "✅ Template criado com sucesso na Meta");
    res.json(json);
  } catch (err) {
    logger.error({ err }, "❌ Erro interno ao criar template");
    res.status(500).json({ error: "Erro interno ao criar template" });
  }
});

export default router;

