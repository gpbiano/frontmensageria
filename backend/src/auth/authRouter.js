import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

// ✅ Prisma-first
import prismaMod from "../lib/prisma.js";
const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

// ✅ PRODUÇÃO: sem fallback de secret (evita invalid signature)
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET não definido no ambiente (.env.production).");
  }
  return secret;
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

const router = express.Router();

// ======================================================
// Password hashing (PBKDF2) — sem deps externas
// Formato: pbkdf2$<iterations>$<saltBase64>$<hashBase64>
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
    if (!passwordHash || typeof passwordHash !== "string") return false;
    if (!passwordHash.startsWith("pbkdf2$")) return false;

    const parts = passwordHash.split("$");
    if (parts.length !== 4) return false;

    const iters = Number(parts[1]);
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");

    const actual = crypto.pbkdf2Sync(
      password,
      salt,
      iters,
      expected.length,
      PBKDF2_DIGEST
    );

    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password, passwordHash, ...rest } = u;
  return rest;
}

function readAuthBearer(req) {
  const h = String(req.headers.authorization || "").trim();
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

function signUserToken({ user, tenantId, tenantSlug }) {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role
  };

  // ✅ o middleware multi-tenant exige tenantId
  if (tenantId) payload.tenantId = String(tenantId);
  if (tenantSlug) payload.tenantSlug = String(tenantSlug);

  return jwt.sign(payload, getJwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

async function getUserByEmail(email) {
  return prisma.user.findFirst({
    where: { email: String(email).toLowerCase() },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isActive: true,
      passwordHash: true,
      // se existir legacy no schema, não quebra:
      password: true
    }
  });
}

async function getTenantsForUser(userId) {
  // Pela tua evidência: tabela UserTenant ligando user -> tenant
  const links = await prisma.userTenant.findMany({
    where: {
      userId: String(userId),
      isActive: true
    },
    select: {
      role: true,
      isActive: true,
      tenant: {
        select: { id: true, slug: true, name: true, isActive: true }
      }
    }
  });

  return (links || [])
    .filter((l) => l?.tenant?.isActive !== false)
    .map((l) => ({
      id: String(l.tenant.id),
      slug: String(l.tenant.slug),
      name: String(l.tenant.name),
      role: l.role
    }));
}

// ======================================================
// POST /login  (Prisma-first + token com tenantId)
// - se 1 tenant: retorna token já com tenantId ✅ resolve 401
// - se >1: retorna token base + tenants para seleção
// ======================================================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "Informe e-mail e senha para entrar." });
    }

    const user = await getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
    if (user.isActive === false)
      return res.status(403).json({ error: "Usuário está inativo." });

    // ✅ Preferência: passwordHash
    if (user.passwordHash) {
      const ok = verifyPassword(String(password), user.passwordHash);
      if (!ok) return res.status(401).json({ error: "Senha incorreta." });
    } else {
      // ✅ Compat antiga (se existir coluna password)
      if (!user.password || String(user.password) !== String(password)) {
        return res.status(401).json({ error: "Senha incorreta." });
      }
    }

    const tenants = await getTenantsForUser(user.id);

    // ✅ se não tiver tenant vinculado -> não deixa passar
    if (!tenants.length) {
      return res.status(403).json({
        error:
          "Usuário sem tenant associado. Vincule em UserTenant antes de acessar."
      });
    }

    // ✅ 1 tenant -> token já pronto com tenantId
    if (tenants.length === 1) {
      const t = tenants[0];
      const token = signUserToken({
        user,
        tenantId: t.id,
        tenantSlug: t.slug
      });

      logger.info(
        { userId: user.id, email: user.email, tenant: t.slug },
        "✅ Login realizado (tenant único)"
      );

      return res.json({
        token,
        user: sanitizeUser(user),
        tenant: { id: t.id, slug: t.slug, name: t.name }
      });
    }

    // ✅ multi-tenant -> token base (sem tenantId) + lista
    const token = signUserToken({ user, tenantId: null, tenantSlug: null });

    logger.info(
      { userId: user.id, email: user.email, tenants: tenants.length },
      "✅ Login realizado (multi-tenant)"
    );

    return res.json({
      token,
      user: sanitizeUser(user),
      tenants: tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name }))
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro no login");
    return res.status(500).json({ error: "Erro ao fazer login." });
  }
});

// ======================================================
// ✅ GET /auth/me
// retorna user + tenants disponíveis
// ======================================================
router.get("/auth/me", async (req, res) => {
  try {
    const token = readAuthBearer(req);
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const decoded = verifyToken(token);
    const userId = decoded?.id;
    if (!userId) return res.status(401).json({ error: "Não autenticado." });

    const user = await prisma.user.findFirst({
      where: { id: String(userId) },
      select: { id: true, email: true, name: true, role: true, isActive: true }
    });
    if (!user || user.isActive === false)
      return res.status(401).json({ error: "Usuário inválido." });

    const tenants = await getTenantsForUser(user.id);

    return res.json({
      user,
      tenants: tenants.map((t) => ({ id: t.id, slug: t.slug, name: t.name }))
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro em /auth/me");
    return res.status(401).json({ error: "Não autenticado." });
  }
});

// ======================================================
// ✅ POST /auth/select-tenant
// body: { tenantId } (aceita id OU slug)
// devolve novo token com tenantId
// ======================================================
router.post("/auth/select-tenant", async (req, res) => {
  try {
    const token = readAuthBearer(req);
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const decoded = verifyToken(token);
    const userId = decoded?.id;
    if (!userId) return res.status(401).json({ error: "Não autenticado." });

    const { tenantId } = req.body || {};
    const tid = String(tenantId || "").trim();
    if (!tid) return res.status(400).json({ error: "tenantId é obrigatório." });

    const user = await prisma.user.findFirst({
      where: { id: String(userId) },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true
      }
    });
    if (!user || user.isActive === false)
      return res.status(401).json({ error: "Usuário inválido." });

    const tenants = await getTenantsForUser(user.id);

    // aceita escolher por ID ou por SLUG
    const chosen =
      tenants.find((t) => String(t.id) === tid) ||
      tenants.find((t) => String(t.slug) === tid);

    if (!chosen) {
      return res
        .status(403)
        .json({ error: "Tenant não permitido para este usuário." });
    }

    const newToken = signUserToken({
      user,
      tenantId: chosen.id,
      tenantSlug: chosen.slug
    });

    return res.json({
      token: newToken,
      user,
      tenant: { id: chosen.id, slug: chosen.slug, name: chosen.name }
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro em /auth/select-tenant");
    return res.status(401).json({ error: "Não autenticado." });
  }
});

// ======================================================
// ✅ POST /auth/set-password (Prisma-first)
// body: { token, password }
// ======================================================
router.post("/auth/set-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const tok = String(token || "").trim();
    const pwd = String(password || "");

    if (!tok) return res.status(400).json({ error: "Token é obrigatório." });
    if (!pwd || pwd.length < 8) {
      return res
        .status(400)
        .json({ error: "A senha deve ter no mínimo 8 caracteres." });
    }

    // ⚠️ Mantive compat por enquanto: se você usa passwordTokens em Prisma, ótimo.
    // Se ainda não existe esse model no schema, me fala e eu ajusto para o formato correto.
    const t = await prisma.passwordToken.findFirst({
      where: { id: tok }
    });

    if (!t) return res.status(404).json({ error: "Token não encontrado." });
    if (t.used === true) return res.status(400).json({ error: "Token já utilizado." });
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now())
      return res.status(400).json({ error: "Token expirado." });

    const user = await prisma.user.findFirst({
      where: { id: String(t.userId) },
      select: { id: true, email: true, isActive: true }
    });

    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (user.isActive === false) return res.status(400).json({ error: "Usuário está inativo." });

    await prisma.user.update({
      where: { id: String(user.id) },
      data: {
        passwordHash: hashPassword(pwd),
        updatedAt: new Date()
      }
    });

    await prisma.passwordToken.update({
      where: { id: tok },
      data: { used: true, usedAt: new Date() }
    });

    logger.info(
      { userId: user.id, email: user.email, tokenType: t.type },
      "🔐 Senha definida com sucesso"
    );

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao definir senha");
    return res.status(500).json({ error: "Erro ao definir senha." });
  }
});

export default router;
