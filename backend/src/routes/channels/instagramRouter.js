import express from "express";
import logger from "../../logger.js";

const router = express.Router();

// ✅ Verificação do Webhook (Meta)
router.get("/", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  const VERIFY = String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "").trim();

  if (mode === "subscribe" && token && token === VERIFY) {
    return res.status(200).send(String(challenge || ""));
  }

  return res.sendStatus(403);
});

// ✅ Recebimento dos eventos (por enquanto só ACK)
router.post("/", (req, res) => {
  try {
    // mais tarde a gente parseia e persiste no core de conversas
    logger.info({ body: req.body }, "📩 Instagram webhook event received");
  } catch (e) {
    logger.warn({ err: String(e) }, "⚠️ Instagram webhook parse warning");
  }
  return res.sendStatus(200);
});

export default router;
