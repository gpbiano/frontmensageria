// backend/src/auth/passwordRouter.js
import express from "express";
import { loadDB, saveDB } from "../utils/db.js";
import { hashPassword } from "../security/passwords.js";
import logger from "../logger.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  return Date.parse(expiresAt) < Date.now();
}

function findToken(db, tokenId) {
  return (db.passwordTokens || []).find(
    (t) => String(t.id) === String(tokenId)
  );
}

/**
 * GET /auth/password/verify?token=...
 * Valida token (existe, não expirou, não foi usado) e retorna dados básicos do usuário.
 */
router.get("/verify", (req, res) => {
  const token = String(req.query.token || "").trim();
  if (!token)
    return res.status(400).json({ valid: false, error: "Token ausente." });

  const db = loadDB();
  const t = findToken(db, token);

  if (!t)
    return res
      .status(404)
      .json({ valid: false, error: "Token não encontrado." });

  if (t.used)
    return res
      .status(400)
      .json({ valid: false, error: "Token já usado." });

  if (isExpired(t.expiresAt))
    return res
      .status(400)
      .json({ valid: false, error: "Token expirado." });

  const user = (db.users || []).find((u) => Number(u.id) === Number(t.userId));
  if (!user)
    return res
      .status(404)
      .json({ valid: false, error: "Usuário não encontrado." });

  if (user.isActive === false)
    return res
      .status(400)
      .json({ valid: false, error: "Usuário inativo." });

  return res.json({
    valid: true,
    type: t.type,
    user: { id: user.id, name: user.name, email: user.email }
  });
});

/**
 * POST /auth/password/set
 * Body: { token, password }
 * Define senha via token (invite/reset).
 */
router.post("/set", (req, res) => {
  const { token, password } = req.body || {};
  const tokenId = String(token || "").trim();
  const pass = String(password || "");

  if (!tokenId)
    return res.status(400).json({ error: "Token é obrigatório." });

  if (!pass || pass.length < 8)
    return res
      .status(400)
      .json({ error: "Senha deve ter no mínimo 8 caracteres." });

  const db = loadDB();
  const t = findToken(db, tokenId);

  if (!t) return res.status(404).json({ error: "Token não encontrado." });
  if (t.used) return res.status(400).json({ error: "Token já usado." });
  if (isExpired(t.expiresAt))
    return res.status(400).json({ error: "Token expirado." });

  const user = (db.users || []).find((u) => Number(u.id) === Number(t.userId));
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  if (user.isActive === false)
    return res.status(400).json({ error: "Usuário inativo." });

  // define senha
  user.passwordHash = hashPassword(pass);
  // remove legado (opcional: delete mesmo para não persistir "undefined")
  delete user.password;
  user.updatedAt = nowIso();

  // marca token atual como usado
  t.used = true;
  t.usedAt = nowIso();

  // opcional: invalida outros tokens pendentes desse usuário (sem mexer no atual)
  for (const other of db.passwordTokens || []) {
    if (
      Number(other.userId) === Number(user.id) &&
      String(other.id) !== String(t.id) &&
      other.used !== true
    ) {
      other.used = true;
      other.usedAt = nowIso();
      other.invalidatedReason = "new_password_set";
    }
  }

  saveDB(db);

  logger.info({ userId: user.id, type: t.type }, "🔐 Senha definida via token");
  return res.json({ success: true });
});

export default router;
