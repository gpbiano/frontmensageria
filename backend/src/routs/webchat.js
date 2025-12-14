import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";

const router = express.Router();

function newId(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

// DEV CORS (pra testar local)
router.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowed =
    !origin ||
    origin.includes("http://localhost") ||
    origin.includes("http://127.0.0.1");

  if (allowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Widget-Key"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).send();
  next();
});

router.post("/session", (req, res) => {
  const widgetKey = req.headers["x-widget-key"];
  if (!widgetKey) return res.status(400).json({ error: "Missing X-Widget-Key" });

  const { visitorId } = req.body || {};

  const conversationId = newId("conv_web");
  const sessionId = newId("wsess");

  const secret = process.env.JWT_SECRET || "dev_secret_change_me";
  const expiresInSeconds = 60 * 30;

  const webchatToken = jwt.sign(
    { typ: "webchat", widgetKey, conversationId, sessionId },
    secret,
    { expiresIn: expiresInSeconds }
  );

  res.json({
    visitorId: visitorId || null,
    sessionId,
    conversationId,
    status: "open",
    expiresInSeconds,
    webchatToken
  });
});

export default router;
