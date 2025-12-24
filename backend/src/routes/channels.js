// src/routes/channels.js (trechos para colar / ajustar)
// ✅ GARANTE redirect_uri idêntico entre FB.login e token exchange

import crypto from "crypto";
import jwt from "jsonwebtoken";
import express from "express";
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

function getStateSecret() {
  const secret = String(process.env.META_STATE_SECRET || process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("META_STATE_SECRET/JWT_SECRET não definido");
  return secret;
}

function normalizeRedirectUri(raw) {
  // ✅ NÃO inventa URL. Só normaliza espaços.
  const u = String(raw || "").trim();
  if (!u) return "";
  // ✅ importantíssimo: NÃO remover trailing slash aqui,
  // porque a Meta exige igualdade exata.
  return u;
}

function signState(payload) {
  return jwt.sign(payload, getStateSecret(), { expiresIn: "10m" });
}

function verifyState(state) {
  try {
    const decoded = jwt.verify(String(state || ""), getStateSecret());
    if (!decoded || typeof decoded !== "object") throw new Error("invalid_state");
    if (!decoded.tenantId) throw new Error("invalid_state");
    if (!decoded.redirectUri) throw new Error("invalid_state");
    return decoded;
  } catch (e) {
    const err = new Error("invalid_state");
    err.cause = e;
    throw err;
  }
}

function getEmbeddedRedirectUri(req) {
  // ✅ fonte única: ENV (já deve estar certo)
  // Se quiser derivar do client host, faça aqui — mas sem “tentar lista”.
  const env = normalizeRedirectUri(process.env.META_EMBEDDED_REDIRECT_URI);
  if (env) return env;

  // fallback seguro (se env não existir):
  // manda sempre pra tela de canais (sem guess)
  return "https://cliente.gplabs.com.br/settings/channels/";
}

// ===============================
// POST /settings/channels/whatsapp/start
// ===============================
router.post("/channels/whatsapp/start", async (req, res) => {
  try {
    const tenantId = req.tenant?.id || req.tenantId;
    const userId = req.user?.id;

    const redirectUri = getEmbeddedRedirectUri(req);

    const state = signState({
      tenantId: String(tenantId),
      userId: userId ? String(userId) : null,
      redirectUri,
      nonce: crypto.randomUUID()
    });

    logger.info({ tenantId, redirectUri }, "🟢 WhatsApp Embedded Signup start");

    return res.json({
      appId: String(process.env.META_APP_ID || ""),
      redirectUri,
      state,
      scopes: ["whatsapp_business_messaging", "business_management"]
    });
  } catch (err) {
    logger.error({ err }, "❌ WhatsApp start error");
    return res.status(500).json({ error: "whatsapp_start_failed" });
  }
});

// ===============================
// POST /settings/channels/whatsapp/callback
// body: { code, state, redirectUri? }
// ===============================
router.post("/channels/whatsapp/callback", async (req, res) => {
  try {
    const { code, state, redirectUri: redirectUriFromClient } = req.body || {};
    if (!code || !state) return res.status(400).json({ error: "missing_code_or_state" });

    const decoded = verifyState(state);

    // ✅ SEMPRE usar o redirectUri do state (fonte da verdade)
    // Se o client mandou, usamos só pra debug/checagem.
    const redirectUri = normalizeRedirectUri(decoded.redirectUri);

    if (redirectUriFromClient) {
      const clientRU = normalizeRedirectUri(redirectUriFromClient);
      if (clientRU && clientRU !== redirectUri) {
        logger.warn(
          { clientRU, stateRU: redirectUri },
          "⚠️ redirectUri do client diferente do state (ignorando client)"
        );
      }
    }

    // ✅ token exchange aqui com redirectUri (exatamente o mesmo do FB.login)
    // ... seu axios/fetch para graph.facebook.com/oauth/access_token ...
    // GARANTA que você passa redirectUri sem alterar.
    //
    // Exemplo:
    // const tokenRes = await axios.get("https://graph.facebook.com/v19.0/oauth/access_token", {
    //   params: {
    //     client_id: process.env.META_APP_ID,
    //     client_secret: process.env.META_APP_SECRET,
    //     redirect_uri: redirectUri,
    //     code
    //   }
    // });

    // ✅ (IMPORTANTE) Quando salvar config no prisma,
    // NÃO envie allowedOrigins/widgetKey para whatsapp se o schema não tiver.
    // Apenas fields que existem no model.

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "❌ whatsapp callback error");
    return res.status(400).json({ error: "whatsapp_connect_failed" });
  }
});

export default router;
