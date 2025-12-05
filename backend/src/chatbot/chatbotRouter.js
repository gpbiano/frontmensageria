import express from "express";
import { getChatbotSettingsForAccount } from "./rulesEngine.js";

const router = express.Router();

/**
 * GET /api/chatbot/settings
 * Retorna as configurações atuais do chatbot
 */
router.get("/chatbot/settings", (req, res) => {
  const accountId = "default";
  const settings = getChatbotSettingsForAccount(accountId);
  res.json(settings);
});

/**
 * PATCH /api/chatbot/settings
 * Atualiza configurações do chatbot (ex: modo híbrido, número de tentativas, palavras-chave)
 */
router.patch("/chatbot/settings", (req, res) => {
  const accountId = "default";
  const body = req.body || {};

  const settings = getChatbotSettingsForAccount(accountId);

  if (body.enabled !== undefined) settings.enabled = body.enabled;
  if (body.maxBotAttempts !== undefined) settings.maxBotAttempts = body.maxBotAttempts;
  if (body.transferKeywords !== undefined) settings.transferKeywords = body.transferKeywords;

  res.json({
    ok: true,
    updated: settings
  });
});

export default router;
