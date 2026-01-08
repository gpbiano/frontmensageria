// backend/src/auth/authRouter.js
import express from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

// ✅ Prisma-first
import prismaMod from "../lib/prisma.js";
const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

// ✅ Billing block message (mesma frase do requisito)
import { BILLING_BLOCK_MESSAGE, _isBlockedByBilling } from "../middleware/enforceBillingAccess.js";

const router = express.Router();

// ======================================================
// JWT
// ======================================================
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET não definido no ambiente.");
  return secret;
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ======================================================
// Password hashing/verify (PBKDF2 + compat legacy)
// ======================================================
const PBKDF2_ITERS = Number(process.env.PBKDF2_ITERS || 150000);
const PBKDF2_KEYLEN = 32;
const PBKDF2_DIGEST = "sha256";

function hashPasswordPBKDF2(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(
    String(password),
    salt,
    PBKDF2_ITERS,
    PBKDF2_KEYLEN,
    PBKDF2_DIGEST
  );
  return `pbkdf2$${PBKDF2_ITERS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

function verifyPasswordPBKDF2(password, passwordHash) {
  try {
    if (!passwordHash?.startsWith("pbkdf2$")) return false;

    const parts = String(passwordHash).split("$");
    if (parts.length !== 4) return false;

    const iters = Number(parts[1]);
    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");

    const actual = crypto.pbkdf2Sync(
      String(password),
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

// ✅ COMPAT: usa o verificador antigo (o que já batia com teu banco)
let verifyPasswordLegacy = null;
try {
  const legacy = await import("../security/passwords.js");
  if (typeof legacy.verifyPassword === "function") {
    verifyPasswordLegacy = legacy.verifyPassword;
    logger.info("✅ verifyPasswordLegacy carregado (security/passwords.js)");
  } else {
    logger.warn("⚠️ security/passwords.js não exporta verifyPassword()");
  }
} catch (e) {
  logger.warn({ e }, "⚠️ Não consegui importar security/passwords.js");
}

// ✅ tenta primeiro LEGADO, depois PBKDF2
function verifyAnyPassword(password, passwordHash) {
  const h = String(passwordHash || "").trim();
  if (!h) return false;

  if (verifyPasswordLegacy) {
    try {
      if (verifyPasswordLegacy(String(password), h)) return true;
    } catch {
      // segue
    }
  }

  if (h.startsWith("pbkdf2$")) {
    return verifyPasswordPBKDF2(String(password), h);
  }

  return false;
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
    where: { email: String(email).toLowerCase().trim() },
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
        select: {
          id: true,
          slug: true,
          name: true,
          isActive: true,
          billing: {
            select: {
              // ✅ essenciais pro bloqueio
              accessStatus: true,
              trialEndsAt: true,
              delinquentSince: true,
              graceDaysAfterDue: true,
              blockedAt: true,
              blockedReason: true,

              // ✅ flags de cobrança
              isFree: true,
              chargeEnabled: true,
              planCode: true,

              // ✅ espelho (opcional, mas útil)
              status: true,
              lastPaymentStatus: true,
              nextChargeDueDate: true
            }
          }
        }
      }
    }
  });

  return (links || [])
    .filter((l) => l?.tenant?.isActive !== false)
    .map((l) => ({
      id: String(l.tenant.id),
      slug: String(l.tenant.slug),
      name: String(l.tenant.name),
      role: l.role,
      billing: l.tenant.billing || null
    }));
}

function pickFirstAllowedTenant(tenants) {
  return tenants?.[0] || null;
}

// ======================================================
// ✅ POST /login (auto-tenant)
// ======================================================
router.post("/login", async (req, res) => {
  try {
    let body = req.body;

    // ✅ body pode vir como Buffer/string se algum middleware mudou
    if (Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(body.toString("utf8"));
      } catch {
        body = {};
      }
    } else if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    body = body && typeof body === "object" ? body : {};

    const email = String(
      body.email ||
        body.login ||
        body.username ||
        body?.user?.email ||
        body?.data?.email ||
        ""
    )
      .trim()
      .toLowerCase();

    const password = String(
      body.password ||
        body.senha ||
        body.pass ||
        body?.user?.password ||
        body?.user?.senha ||
        body?.data?.password ||
        body?.data?.senha ||
        ""
    ).trim();

    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const user = await getUserByEmail(email);

    if (!user || user.isActive === false) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const hash = String(user.passwordHash || "");
    const ok = verifyAnyPassword(password, user.passwordHash);

    if (!ok) {
      logger.warn(
        {
          email: user.email,
          userId: user.id,
          hashPrefix: hash.slice(0, 16),
          hashLen: hash.length,
          hasLegacyVerifier: !!verifyPasswordLegacy,
          looksPBKDF2: hash.startsWith("pbkdf2$"),
          looksBcrypt:
            hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$")
        },
        "❌ Login: senha não conferiu"
      );
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const tenants = await getTenantsForUser(user.id);
    if (!tenants.length) {
      return res.status(403).json({ error: "Usuário sem tenant associado." });
    }

    const chosen = pickFirstAllowedTenant(tenants);
    if (!chosen) {
      return res.status(403).json({ error: "Usuário sem tenant associado." });
    }

    // ✅ BLOQUEIO POR BILLING AQUI
    if (_isBlockedByBilling(chosen.billing)) {
      return res.status(403).json({
        error: "account_blocked",
        message: BILLING_BLOCK_MESSAGE
      });
    }

    const token = signUserToken({
      user,
      tenantId: chosen.id,
      tenantSlug: chosen.slug
    });

    logger.info({ userId: user.id, email: user.email, tenant: chosen.slug }, "✅ Login realizado");

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
      user: { id: decoded.id, email: decoded.email, role: decoded.role },
      tenant: { id: decoded.tenantId || null, slug: decoded.tenantSlug || null }
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
    const tid = String(tenantId || "").trim();
    if (!tid) return res.status(400).json({ error: "tenantId é obrigatório." });

    const tenants = await getTenantsForUser(decoded.id);

    const chosen =
      tenants.find((t) => String(t.id) === tid) || tenants.find((t) => String(t.slug) === tid);

    if (!chosen) {
      return res.status(403).json({ error: "Tenant não permitido." });
    }

    // ✅ BLOQUEIO POR BILLING
    if (_isBlockedByBilling(chosen.billing)) {
      return res.status(403).json({
        error: "account_blocked",
        message: BILLING_BLOCK_MESSAGE
      });
    }

    const newToken = signUserToken({
      user: decoded, // decoded tem id/email/role
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
// ✅ POST /auth/set-password (agora usa PasswordToken.token opaco)
// Body: { token, password }
// ======================================================
router.post("/auth/set-password", async (req, res) => {
  try {
    const { token, password } = req.body || {};
    const tok = String(token || "").trim();
    const pwd = String(password || "");

    if (!tok) return res.status(400).json({ error: "Token é obrigatório." });
    if (!pwd || pwd.length < 8) {
      return res.status(400).json({ error: "A senha deve ter no mínimo 8 caracteres." });
    }

    // ✅ procura pelo campo token (opaco), não por id
    const t = await prisma.passwordToken.findFirst({
      where: { token: tok }
    });

    if (!t) return res.status(404).json({ error: "Token não encontrado." });
    if (t.used === true) return res.status(400).json({ error: "Token já utilizado." });
    if (t.expiresAt && new Date(t.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Token expirado." });
    }

    const user = await prisma.user.findFirst({
      where: { id: String(t.userId) },
      select: { id: true, email: true, isActive: true }
    });

    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
    if (user.isActive === false) return res.status(400).json({ error: "Usuário está inativo." });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: String(user.id) },
        data: { passwordHash: hashPasswordPBKDF2(pwd), updatedAt: new Date() }
      });

      // ✅ marca como usado pelo ID do registro (mais seguro)
      await tx.passwordToken.update({
        where: { id: String(t.id) },
        data: { used: true, usedAt: new Date() }
      });
    });

    logger.info({ userId: user.id, email: user.email }, "🔐 Senha definida");

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao definir senha");
    return res.status(500).json({ error: "Erro ao definir senha." });
  }
});

export default router;
