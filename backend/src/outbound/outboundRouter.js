// backend/src/outbound/outboundRouter.js
import express from "express";
import { sendTemplateCampaign } from "./campaignEngine.js";

const router = express.Router();

/* ============================================================
   CAMPANHAS – ENVIO DE TEMPLATE (usa campaignEngine)
   ============================================================ */

/**
 * POST /outbound/campaigns
 *
 * body:
 * {
 *   "name": "Campanha X",
 *   "template": "nome_do_template",
 *   "parameters": ["Var1", "Var2"],
 *   "targets": ["5511999999999", "5511888888888"],
 *   "description": "Opcional"
 * }
 */
router.post("/campaigns", async (req, res) => {
  try {
    const { name, template, parameters, targets, description } = req.body || {};

    const result = await sendTemplateCampaign({
      name,
      template,
      parameters,
      targets,
      description
    });

    return res.json({
      success: true,
      id: result.campaignId,
      totalTargets: result.totalTargets,
      results: result.results
    });
  } catch (err) {
    console.error("❌ Erro em /outbound/campaigns", err);
    return res.status(400).json({
      success: false,
      error: err.message || "Erro ao enviar campanha."
    });
  }
});

export default router;
