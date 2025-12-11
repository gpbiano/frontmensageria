// backend/src/outbound/campaignEngine.js
import fetch from "node-fetch";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import logger from "../logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const DB_FILE = path.join(process.cwd(), "data.json");

function loadDB() {
  try {
    const raw = fs.readFileSync(DB_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.warn(
      { err },
      "⚠️ data.json não encontrado ao carregar no campaignEngine, usando objeto vazio."
    );
    return {};
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "❌ Erro ao salvar data.json no campaignEngine");
  }
}

/**
 * Envia uma campanha de TEMPLATE para uma lista de alvos.
 *
 * Parâmetros:
 * - name: nome interno da campanha
 * - template: nome do template HSM aprovado na Meta
 * - parameters: array de strings para o body
 * - targets: array de telefones (E.164)
 * - description: descrição interna
 *
 * Retorno:
 * {
 *   campaignId,
 *   totalTargets,
 *   results,
 *   campaign
 * }
 */
export async function sendTemplateCampaign({
  name,
  template,
  parameters,
  targets,
  description
}) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error(
      "WHATSAPP_TOKEN ou PHONE_NUMBER_ID não configurados nas variáveis de ambiente."
    );
  }

  if (
    !template ||
    !targets ||
    !Array.isArray(targets) ||
    targets.length === 0
  ) {
    throw new Error("Dados insuficientes para campanha (template/targets).");
  }

  const db = loadDB();
  if (!db.campaigns) db.campaigns = [];

  const campaignId = db.campaigns.length + 1;

  const results = [];

  logger.info(
    {
      campaignId,
      name,
      template,
      totalTargets: targets.length
    },
    "📣 Iniciando envio de campanha de template"
  );

  for (const phone of targets) {
    const payload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: template,
        language: { code: "pt_BR" },
        components:
          parameters && parameters.length > 0
            ? [
                {
                  type: "body",
                  parameters: parameters.map((p) => ({
                    type: "text",
                    text: p
                  }))
                }
              ]
            : []
      }
    };

    try {
      const response = await fetch(
        `https://graph.facebook.com/v22.0/${PHONE_NUMBER_ID}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await response.json();

      results.push({ phone, result, ok: response.ok });

      if (!response.ok) {
        logger.error(
          { phone, status: response.status, result },
          "❌ Erro ao enviar mensagem de template na campanha"
        );
      } else {
        logger.info(
          { phone, messageId: result?.messages?.[0]?.id },
          "📤 Template enviado com sucesso na campanha"
        );
      }
    } catch (err) {
      logger.error({ phone, err }, "❌ Erro inesperado ao enviar template");
      results.push({
        phone,
        result: { error: err.message },
        ok: false
      });
    }
  }

  const campaign = {
    id: campaignId,
    name,
    template,
    parameters,
    targets,
    description,
    results,
    totalTargets: targets.length,
    createdAt: new Date().toISOString()
  };

  db.campaigns.push(campaign);
  saveDB(db);

  logger.info(
    {
      campaignId,
      totalTargets: targets.length
    },
    "✅ Campanha concluída e salva em data.json"
  );

  return {
    campaignId,
    totalTargets: targets.length,
    results,
    campaign
  };
}
