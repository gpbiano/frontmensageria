// backend/src/auth/passwordRouter.js
import express from "express";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import logger from "../logger.js";
import { hashPassword } from "../security/passwords.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function ensureDbArrays(db) {
  db.users = ensureArray(db.users);
  db.passwordTokens = ensureArray(db.passwordTokens);
  return db;
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) <= Date.now();
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password, passwordHash, ...rest } = u;
  return rest;
}

/**
 * 🔎 helper: localiza token por id OU token (backward/forward compatible)
 */
function findToken(db, tokenId) {
  return (db.passwordTokens || []).find(
    (t) =>
      String(t.id) === tokenId ||
      String(t.token) === tokenId
  );
}

/**
 * GET /auth/password/verify?token=...
 * Público: valida token (invite/reset)
 */
router.get("/password/verify", (req, res) => {
  const tokenId = String(req.query?.token || "").trim();
  if (!tokenId) {
    return res.status(400).json({ error: "Token é obrigatório." });
  }

  const db = ensureDbArrays(loadDB());

  const token = findToken(db, tokenId);
  if (!token) {
    return res.status(404).json({ error: "Token não encontrado." });
  }

  if (token.used === true) {
    return res.status(410).json({ error: "Token já utilizado." });
  }

  if (isExpired(token.expiresAt)) {
    return res.status(410).json({ error: "Token expirado." });
  }

  const user = (db.users || []).find(
    (u) => Number(u.id) === Number(token.userId)
  );

  if (!user) {
    return res.status(404).json({ error: "Usuário do token não encontrado." });
  }

  if (user.isActive === false) {
    return res.status(403).json({ error: "Usuário inativo." });
  }

  return res.json({
    valid: true,
    token: {
      id: token.id || token.token,
      type: token.type,
      expiresAt: token.expiresAt
    },
    user: sanitizeUser(user)
  });
});

/**
 * POST /auth/password/set
 * Público: define senha usando token
 */
router.post("/password/set", (req, res) => {
  const tokenId = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!tokenId) {
    return res.status(400).json({ error: "Token é obrigatório." });
  }

  if (!password || password.length < 8) {
    return res
      .status(400)
      .json({ error: "Senha inválida (mínimo 8 caracteres)." });
  }

  const db = ensureDbArrays(loadDB());

  const token = findToken(db, tokenId);
  if (!token) {
    return res.status(404).json({ error: "Token não encontrado." });
  }

  if (token.used === true) {
    return res.status(410).json({ error: "Token já utilizado." });
  }

  if (isExpired(token.expiresAt)) {
    return res.status(410).json({ error: "Token expirado." });
  }

  const user = (db.users || []).find(
    (u) => Number(u.id) === Number(token.userId)
  );

  if (!user) {
    return res.status(404).json({ error: "Usuário não encontrado." });
  }

  if (user.isActive === false) {
    return res.status(403).json({ error: "Usuário inativo." });
  }

  // 🔐 define senha com hash
  user.passwordHash = hashPassword(password);
  user.password = null;
  user.updatedAt = nowIso();

  // marca token como usado
  token.used = true;
  token.usedAt = nowIso();

  saveDB(db);

  logger.info(
    { userId: user.id, tokenType: token.type },
    "🔐 Senha definida com sucesso via token"
  );

  return res.json({
    success: true,
    user: sanitizeUser(user)
  });
});

export default router;

