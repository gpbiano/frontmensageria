import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

// ✅ Prisma-first
import prismaMod from "../lib/prisma.js";
const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

// ======================================================
// JWT
// ======================================================
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não definido no ambiente.");
  }
  return secret;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ======================================================
// Password hashing (PBKDF2)
// ======================================================
const PBKDF2_ITERS = Number(process.env.PBKDF2_ITERS || 150000);
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(
    password,
    salt,
    PBKDF2_ITERS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString("base64")}$${hash.toString(
    "base64"
  )}`;
}

function verifyPassword(password, passwordHash) {
  try {
    if (!passwordHash?.startsWith("pbkdf2$")) return false;
    const [, iters, saltB64, hashB64] = passwordHash.split("$");

    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(hashB64, "base64");

    const actual = crypto.pbkdf2Sync(
      password,
      salt,
      Number(iters),
      expected.length,
      PBKDF2_DIGEST
    );

    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ======================================================
// Helpers
// ======================================================
function sanitizeUser(u) {
  if (!u) return u;
  const { passwordHash, ...rest } = u;
  return rest;
}

function readAuthBearer(req) {
  const h = String(req.headers.authorization || "");
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function signUserToken({ user, tenantId, tenantSlug }) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      tenantId: String(tenantId),
      tenantSlug: tenantSlug ? String(tenantSlug) : undefined
    },
    getJwtSecret(),
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// ======================================================
// Prisma helpers
// ======================================================
async function getUserByEmail(email) {
  return prisma.user.findFirst({
    where: {
      email: String(email).toLowerCase(),
      isActive: true
    },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true
    }
  });
}

async function getTenantsForUser(userId) {
  const links = await prisma.userTenant.findMany({
    where: { userId: String(userId), isActive: true },
    select: {
      role: true,
      tenant: {
        select: { id: true, slug: true, name: true, isActive: true }
      }
    }
  });

  return links
    .filter((l) => l.tenant?.isActive !== false)
    .map((l) => ({
      id: l.tenant.id,
      slug: l.tenant.slug,
      name: l.tenant.name,
      role: l.role
    }));
}

// ======================================================
// ✅ POST /login (auto-tenant)
// ======================================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Credenciais inválidas." });

    const ok = verifyPassword(String(password), user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Credenciais inválidas." });

    const tenants = await getTenantsForUser(user.id);
    if (!tenants.length) {
      return res.status(403).json({ error: "Usuário sem tenant associado." });
    }

    const chosen = tenants[0];

    const token = signUserToken({
      user,
      tenantId: chosen.id,
      tenantSlug: chosen.slug
    });

    logger.info(
      { userId: user.id, email: user.email, tenant: chosen.slug },
      "✅ Login realizado"
    );

    return res.json({
      token,
      user: sanitizeUser(user),
      tenant: { id: chosen.id, slug: chosen.slug, name: chosen.name }
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro no login");
    return res.status(500).json({ error: "Erro ao fazer login." });
  }
});

// ======================================================
// ✅ GET /auth/me
// ======================================================
router.get("/auth/me", async (req, res) => {
  try {
    const token = readAuthBearer(req);
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const decoded = verifyToken(token);

    return res.json({
      user: {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role
      },
      tenant: {
        id: decoded.tenantId,
        slug: decoded.tenantSlug
      }
    });
  } catch (err) {
    logger.error({ err }, "❌ /auth/me");
    return res.status(401).json({ error: "Não autenticado." });
  }
});

// ======================================================
// ✅ POST /auth/select-tenant
// ======================================================
router.post("/auth/select-tenant", async (req, res) => {
  try {
    const token = readAuthBearer(req);
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const decoded = verifyToken(token);
    const { tenantId } = req.body || {};
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId é obrigatório." });
    }

    const tenants = await getTenantsForUser(decoded.id);
    const chosen =
      tenants.find((t) => t.id === tenantId) ||
      tenants.find((t) => t.slug === tenantId);

    if (!chosen) {
      return res.status(403).json({ error: "Tenant não permitido." });
    }

    const newToken = signUserToken({
      user: decoded,
      tenantId: chosen.id,
      tenantSlug: chosen.slug
    });

    return res.json({
      token: newToken,
      tenant: { id: chosen.id, slug: chosen.slug, name: chosen.name }
    });
  } catch (err) {
    logger.error({ err }, "❌ /auth/select-tenant");
    return res.status(401).json({ error: "Não autenticado." });
  }
});

// ======================================================
// ✅ POST /auth/set-password
// ======================================================
router.post("/auth/set-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || !password || password.length < 8) {
      return res.status(400).json({ error: "Senha inválida." });
    }

    const t = await prisma.passwordToken.findFirst({ where: { id: token } });
    if (!t || t.used) {
      return res.status(400).json({ error: "Token inválido." });
    }

    await prisma.user.update({
      where: { id: String(t.userId) },
      data: { passwordHash: hashPassword(password) }
    });

    await prisma.passwordToken.update({
      where: { id: token },
      data: { used: true, usedAt: new Date() }
    });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ set-password");
    return res.status(500).json({ error: "Erro ao definir senha." });
  }
});

export default router;
