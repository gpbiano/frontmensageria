// backend/src/routes/channels/instagramRouter.js
import express from "express";
import logger from "../../logger.js";

const router = express.Router();

function getQueryString(q) {
  if (Array.isArray(q)) return String(q[0] || "");
  return String(q || "");
}

// ✅ Verificação do Webhook (Meta)
// Meta faz GET com: hub.mode, hub.verify_token, hub.challenge
router.get("/", (req, res) => {
  const mode = getQueryString(req.query["hub.mode"]).trim();
  const token = getQueryString(req.query["hub.verify_token"]).trim();
  const challenge = getQueryString(req.query["hub.challenge"]);

  const VERIFY = String(process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || "").trim();

  if (mode === "subscribe" && VERIFY && token && token === VERIFY) {
    // ✅ importante: retornar o challenge como TEXTO (não JSON)
    res.status(200);
    res.set("Content-Type", "text/plain");
    return res.send(String(challenge || ""));
  }

  logger.warn(
    { mode, hasToken: !!token, hasVerify: !!VERIFY },
    "❌ Instagram webhook verification failed"
  );
  return res.sendStatus(403);
});

// ✅ Recebimento dos eventos (por enquanto só ACK)
router.post("/", (req, res) => {
  try {
    // mais tarde: validar assinatura (x-hub-signature-256) e persistir no core
    logger.info(
      { hasBody: !!req.body, keys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [] },
      "📩 Instagram webhook event received"
    );
  } catch (e) {
    logger.warn({ err: String(e) }, "⚠️ Instagram webhook log warning");
  }
  return res.sendStatus(200);
});

// (Opcional) ajudar debug
router.all("/", (_req, res) => res.sendStatus(405));

export default router;
