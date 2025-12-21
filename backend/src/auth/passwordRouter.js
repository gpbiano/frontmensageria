// backend/src/auth/passwordRouter.js
import express from "express";
import bcrypt from "bcryptjs";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";

const router = express.Router();

function normalizeToken(token) {
  return String(token || "").trim();
}

function isExpired(expiresAt) {
  if (!expiresAt) return true;
  const t = new Date(expiresAt).getTime();
  return Number.isNaN(t) || t <= Date.now();
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password, passwordHash, ...rest } = u;
  return rest;
}

/**
 * 🔎 helper: localiza token por id (Prisma PasswordToken)
 */
async function findToken(tokenId) {
  return prisma.passwordToken.findUnique({
    where: { id: tokenId },
    include: { user: true },
  });
}

/**
 * GET /auth/password/verify?token=...
 * Público: valida token (invite/reset) - COMPAT com o frontend antigo
 */
router.get("/password/verify", async (req, res) => {
  try {
    const tokenId = normalizeToken(req.query?.token);
    if (!tokenId) {
      return res.status(400).json({ error: "Token é obrigatório." });
    }

    const token = await findToken(tokenId);
    if (!token) {
      return res.status(404).json({ error: "Token não encontrado." });
    }

    if (token.used === true) {
      return res.status(410).json({ error: "Token já utilizado." });
    }

    if (isExpired(token.expiresAt)) {
      return res.status(410).json({ error: "Token expirado." });
    }

    if (!token.user) {
      return res.status(404).json({ error: "Usuário do token não encontrado." });
    }

    // checa se o usuário está ativo no tenant do token
    const membership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: token.userId, tenantId: token.tenantId } },
      select: { isActive: true },
    });

    if (!membership || membership.isActive === false) {
      return res.status(403).json({ error: "Usuário inativo." });
    }

    return res.json({
      valid: true,
      token: {
        id: token.id,
        type: token.type,
        expiresAt: token.expiresAt?.toISOString?.() || token.expiresAt,
      },
      user: sanitizeUser(token.user),
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ password verify error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /auth/password/validate-token
 * Público: valida token (opcional, formato novo)
 * body: { token }
 */
router.post("/password/validate-token", async (req, res) => {
  try {
    const tokenId = normalizeToken(req.body?.token);
    if (!tokenId) return res.status(400).json({ valid: false, error: "token_required" });

    const token = await findToken(tokenId);
    if (!token) return res.status(404).json({ valid: false, error: "token_not_found" });
    if (token.used) return res.status(410).json({ valid: false, error: "token_used" });
    if (isExpired(token.expiresAt)) return res.status(410).json({ valid: false, error: "token_expired" });

    const membership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: token.userId, tenantId: token.tenantId } },
      select: { isActive: true },
    });

    if (!membership || membership.isActive === false) {
      return res.status(403).json({ valid: false, error: "membership_inactive" });
    }

    return res.json({
      valid: true,
      type: token.type,
      email: token.user?.email || null,
      name: token.user?.name || null,
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ validate-token error");
    return res.status(500).json({ valid: false, error: "internal_error" });
  }
});

/**
 * POST /auth/password/set
 * Público: define senha usando token (Prisma)
 * body: { token, password }
 */
router.post("/password/set", async (req, res) => {
  try {
    const tokenId = normalizeToken(req.body?.token);
    const password = String(req.body?.password || "");

    if (!tokenId) {
      return res.status(400).json({ error: "Token é obrigatório." });
    }

    // mantive padrão mínimo 8 como seu router antigo
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Senha inválida (mínimo 8 caracteres)." });
    }

    const token = await findToken(tokenId);
    if (!token) return res.status(404).json({ error: "Token não encontrado." });
    if (token.used) return res.status(410).json({ error: "Token já utilizado." });
    if (isExpired(token.expiresAt)) return res.status(410).json({ error: "Token expirado." });

    if (!token.user) return res.status(404).json({ error: "Usuário não encontrado." });

    const membership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: token.userId, tenantId: token.tenantId } },
      select: { isActive: true },
    });

    if (!membership || membership.isActive === false) {
      // já invalida o token para não ficar reutilizável
      await prisma.passwordToken.update({
        where: { id: tokenId },
        data: {
          used: true,
          usedAt: new Date(),
          invalidatedReason: "membership_inactive_or_missing",
        },
      });
      return res.status(403).json({ error: "Usuário inativo." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      prisma.passwordToken.update({
        where: { id: tokenId },
        data: { used: true, usedAt: new Date() },
      }),
    ]);

    logger.info(
      { userId: token.userId, tokenType: token.type, tenantId: token.tenantId },
      "🔐 Senha definida com sucesso via token (Prisma)"
    );

    return res.json({
      success: true,
      user: sanitizeUser(token.user),
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ password set error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
