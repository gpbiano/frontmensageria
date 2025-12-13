// backend/src/auth/authRouter.js
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { loadDB, saveDB } from "../utils/db.js";
import logger from "../logger.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "gplabs-dev-secret";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ======================================================
// Password hashing (PBKDF2) — sem deps externas
// Formato: pbkdf2$<iterations>$<saltBase64>$<hashBase64>
// ======================================================
const PBKDF2_ITERS = Number(process.env.PBKDF2_ITERS || 150000);
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPassword(password, passwordHash) {
  try {
    if (!passwordHash || typeof passwordHash !== "string") return false;

    // compat: se alguém salvar "plain:" etc (não recomendado)
    if (!passwordHash.startsWith("pbkdf2$")) return false;

    const parts = passwordHash.split("$");
    if (parts.length !== 4) return false;

    const iters = Number(parts[1]);
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");

    const actual = crypto.pbkdf2Sync(password, salt, iters, expected.length, PBKDF2_DIGEST);

    // timing-safe compare
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password, passwordHash, ...rest } = u;
  return rest;
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const ts = Date.parse(expiresAt);
  if (!Number.isFinite(ts)) return true;
  return Date.now() > ts;
}

// ======================================================
// POST /login  (mantém seu contrato atual)
// ======================================================
router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha para entrar." });
    }

    const db = loadDB();
    const users = db.users || [];

    const user = users.find(
      (u) => u.email && String(u.email).toLowerCase() === String(email).toLowerCase()
    );

    if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
    if (user.isActive === false) return res.status(403).json({ error: "Usuário está inativo." });

    // ✅ Preferência: passwordHash
    if (user.passwordHash) {
      const ok = verifyPassword(String(password), user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Senha incorreta." });
    } else {
      // ✅ Compat DEV antigo (senha em texto puro)
      if (!user.password || String(user.password) !== String(password)) {
        return res.status(401).json({ error: "Senha incorreta." });
      }
    }

    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN
    });

    logger.info({ email: user.email, userId: user.id }, "✅ Login realizado");

    return res.json({
      token,
      user: sanitizeUser(user)
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro no login");
    return res.status(500).json({ error: "Erro ao fazer login." });
  }
});

// ======================================================
// POST /auth/validate-token  (opcional, ajuda o front)
// body: { token }
// ======================================================
router.post("/auth/validate-token", (req, res) => {
  try {
    const { token } = req.body || {};
    const tok = String(token || "").trim();
    if (!tok) return res.status(400).json({ error: "Token é obrigatório." });

    const db = loadDB();
    const list = db.passwordTokens || [];
    const t = list.find((x) => String(x.id) === tok);

    if (!t) return res.status(404).json({ valid: false, error: "Token não encontrado." });
    if (t.used === true) return res.status(400).json({ valid: false, error: "Token já utilizado." });
    if (isExpired(t.expiresAt)) return res.status(400).json({ valid: false, error: "Token expirado." });

    const user = (db.users || []).find((u) => Number(u.id) === Number(t.userId));
    if (!user) return res.status(404).json({ valid: false, error: "Usuário do token não encontrado." });
    if (user.isActive === false) return res.status(400).json({ valid: false, error: "Usuário inativo." });

    return res.json({
      valid: true,
      type: t.type || "invite",
      expiresAt: t.expiresAt,
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao validar token");
    return res.status(500).json({ error: "Erro ao validar token." });
  }
});

// ======================================================
// ✅ POST /auth/set-password
// body: { token, password }
// ======================================================
router.post("/auth/set-password", (req, res) => {
  try {
    const { token, password } = req.body || {};
    const tok = String(token || "").trim();
    const pwd = String(password || "");

    if (!tok) return res.status(400).json({ error: "Token é obrigatório." });
    if (!pwd || pwd.length < 8) {
      return res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres." });
    }

    const db = loadDB();
    db.passwordTokens = db.passwordTokens || [];
    db.users = db.users || [];

    const t = db.passwordTokens.find((x) => String(x.id) === tok);
    if (!t) return res.status(404).json({ error: "Token não encontrado." });
    if (t.used === true) return res.status(400).json({ error: "Token já utilizado." });
    if (isExpired(t.expiresAt)) return res.status(400).json({ error: "Token expirado." });

    const user = db.users.find((u) => Number(u.id) === Number(t.userId));
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (user.isActive === false) return res.status(400).json({ error: "Usuário está inativo." });

    // grava hash e remove compat antiga
    user.passwordHash = hashPassword(pwd);
    user.updatedAt = nowIso();
    if ("password" in user) delete user.password;

    // marca token como usado
    t.used = true;
    t.usedAt = nowIso();

    saveDB(db);

    logger.info({ userId: user.id, email: user.email, tokenType: t.type }, "🔐 Senha definida com sucesso");
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao definir senha");
    return res.status(500).json({ error: "Erro ao definir senha." });
  }
});

export default router;

