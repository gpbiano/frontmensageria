// backend/src/settings/usersRouter.js
import express from "express";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant, requireRole } from "../middleware/requireAuth.js";
import { sendEmail } from "../email/resendClient.js";
import logger from "../logger.js";

const router = express.Router();

const APP_BASE_URL = String(process.env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const ROLES = ["admin", "manager", "agent", "viewer"];

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function isValidRole(role) {
  return ROLES.includes(String(role || "").trim().toLowerCase());
}
function parseBoolean(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}
function getTenantId(req) {
  const tenantId = req.tenant?.id || req.tenantId;
  return tenantId ? String(tenantId) : null;
}
function newTokenId(prefix = "tok") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function shapeMembership(ut) {
  const u = ut?.user || {};
  return {
    id: u.id,
    name: u.name || null,
    email: u.email,
    role: ut.role,
    isActive: ut.isActive !== false,
    membershipId: ut.id,
    tenantId: ut.tenantId,
    createdAt: ut.createdAt,
    updatedAt: ut.updatedAt,
  };
}

// ✅ Reuse o seu HTML bonito daqui, se quiser.
// Eu deixei simples pra não poluir o arquivo.
function buildInviteEmail({ name, tokenId }) {
  const link = `${APP_BASE_URL}/criar-senha?token=${encodeURIComponent(tokenId)}`;
  return {
    subject: "GP Labs — Crie sua senha de acesso",
    text:
      `Olá${name ? `, ${name}` : ""}!\n\n` +
      `Para ativar seu usuário e criar sua senha, acesse:\n${link}\n\n` +
      `Este link expira em 24h.`,
    html: `<p>Olá${name ? `, ${name}` : ""}!</p><p>Crie sua senha: <a href="${link}">${link}</a></p><p>Expira em 24h.</p>`,
  };
}

function buildResetEmail({ name, tokenId }) {
  const link = `${APP_BASE_URL}/criar-senha?token=${encodeURIComponent(tokenId)}`;
  return {
    subject: "GP Labs — Redefinição de senha",
    text:
      `Olá${name ? `, ${name}` : ""}!\n\n` +
      `Para redefinir sua senha, acesse:\n${link}\n\n` +
      `Este link expira em 24h.`,
    html: `<p>Olá${name ? `, ${name}` : ""}!</p><p>Redefina sua senha: <a href="${link}">${link}</a></p><p>Expira em 24h.</p>`,
  };
}

async function invalidateUserTokens({ tenantId, userId, reason = "invalidated" }) {
  await prisma.passwordToken.updateMany({
    where: { tenantId, userId, used: false },
    data: {
      used: true,
      usedAt: new Date(),
      invalidatedReason: reason,
    },
  });
}

/**
 * GET /settings/users
 */
router.get("/users", requireAuth, enforceTokenTenant, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const memberships = await prisma.userTenant.findMany({
      where: { tenantId },
      include: { user: true },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
    });

    return res.json({ data: memberships.map(shapeMembership), total: memberships.length });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users list error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * GET /settings/users/:id
 */
router.get("/users/:id", requireAuth, enforceTokenTenant, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ error: "ID inválido." });

    const ut = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });

    if (!ut) return res.status(404).json({ error: "Usuário não encontrado no tenant." });

    return res.json({ user: shapeMembership(ut) });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users get error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /settings/users
 * cria user + membership + token invite + email
 */
router.post("/users", requireAuth, enforceTokenTenant, requireRole("admin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const role = String(req.body?.role || "agent").trim().toLowerCase();

    if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
    if (!email) return res.status(400).json({ error: "E-mail é obrigatório." });
    if (!isValidEmail(email)) return res.status(400).json({ error: "E-mail inválido." });
    if (!isValidRole(role)) return res.status(400).json({ error: `Role inválida: ${role}` });

    // 1) User global
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({ data: { name, email } });
    } else if (!user.name && name) {
      user = await prisma.user.update({ where: { id: user.id }, data: { name } });
    }

    // 2) membership
    const existingMembership = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId: user.id, tenantId } },
    });
    if (existingMembership) return res.status(409).json({ error: "Usuário já existe neste tenant." });

    const ut = await prisma.userTenant.create({
      data: { userId: user.id, tenantId, role, isActive: true },
      include: { user: true },
    });

    // 3) token invite (invalida antigos)
    await invalidateUserTokens({ tenantId, userId: user.id, reason: "new_invite_requested" });

    const tokenId = newTokenId("invite");
    const token = await prisma.passwordToken.create({
      data: {
        id: tokenId,
        tenantId,
        userId: user.id,
        type: "invite",
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        used: false,
      },
    });

    // 4) e-mail
    try {
      const mail = buildInviteEmail({ name: user.name, tokenId: token.id });
      await sendEmail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text });
      logger.info({ userId: user.id, email: user.email, tenantId }, "📧 Convite enviado (criar senha)");
    } catch (e) {
      logger.error({ err: e?.message || e, userId: user.id, email: user.email, tenantId }, "❌ Falha ao enviar convite");
    }

    return res.status(201).json({
      success: true,
      user: shapeMembership(ut),
      token: { id: token.id, type: token.type, expiresAt: token.expiresAt.toISOString() },
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users create error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/users/:id
 */
router.patch("/users/:id", requireAuth, enforceTokenTenant, requireRole("admin", "manager"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ error: "ID inválido." });

    const ut = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
    if (!ut) return res.status(404).json({ error: "Usuário não encontrado no tenant." });

    const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, "name");
    const hasRole = Object.prototype.hasOwnProperty.call(req.body || {}, "role");
    const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, "isActive");

    if (hasRole) {
      const newRole = String(req.body?.role || "").trim().toLowerCase();
      if (req.user?.role === "manager" && newRole === "admin") {
        return res.status(403).json({ error: "Manager não pode promover para admin." });
      }
    }

    if (hasName) {
      const newName = String(req.body?.name || "").trim();
      if (!newName) return res.status(400).json({ error: "Nome inválido." });
      await prisma.user.update({ where: { id: userId }, data: { name: newName } });
    }

    const dataMembership = {};
    if (hasRole) {
      const newRole = String(req.body?.role || "").trim().toLowerCase();
      if (!isValidRole(newRole)) return res.status(400).json({ error: `Role inválida: ${newRole}` });
      dataMembership.role = newRole;
    }
    if (hasIsActive) {
      const parsed = parseBoolean(req.body?.isActive);
      if (parsed === undefined) return res.status(400).json({ error: "isActive inválido (use true/false)." });
      dataMembership.isActive = parsed;

      if (parsed === false) {
        await invalidateUserTokens({ tenantId, userId, reason: "membership_deactivated" });
      }
    }

    if (Object.keys(dataMembership).length > 0) {
      await prisma.userTenant.update({ where: { id: ut.id }, data: dataMembership });
    }

    const updated = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });

    return res.json({ success: true, user: shapeMembership(updated) });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users patch error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/users/:id/deactivate
 */
router.patch("/users/:id/deactivate", requireAuth, enforceTokenTenant, requireRole("admin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ error: "ID inválido." });

    const ut = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
    if (!ut) return res.status(404).json({ error: "Usuário não encontrado no tenant." });

    await invalidateUserTokens({ tenantId, userId, reason: "membership_deactivated" });

    const updated = await prisma.userTenant.update({
      where: { id: ut.id },
      data: { isActive: false },
      include: { user: true },
    });

    return res.json({ success: true, user: shapeMembership(updated) });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users deactivate error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * PATCH /settings/users/:id/activate
 */
router.patch("/users/:id/activate", requireAuth, enforceTokenTenant, requireRole("admin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ error: "ID inválido." });

    const ut = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
    if (!ut) return res.status(404).json({ error: "Usuário não encontrado no tenant." });

    const updated = await prisma.userTenant.update({
      where: { id: ut.id },
      data: { isActive: true },
      include: { user: true },
    });

    return res.json({ success: true, user: shapeMembership(updated) });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users activate error");
    return res.status(500).json({ error: "internal_error" });
  }
});

/**
 * POST /settings/users/:id/reset-password
 * (admin) - token reset + email
 */
router.post("/users/:id/reset-password", requireAuth, enforceTokenTenant, requireRole("admin"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const userId = String(req.params.id || "").trim();
    if (!userId) return res.status(400).json({ error: "ID inválido." });

    const ut = await prisma.userTenant.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
      include: { user: true },
    });
    if (!ut) return res.status(404).json({ error: "Usuário não encontrado no tenant." });
    if (ut.isActive === false) return res.status(400).json({ error: "Usuário inativo no tenant." });

    await invalidateUserTokens({ tenantId, userId, reason: "new_reset_requested" });

    const tokenId = newTokenId("reset");
    const token = await prisma.passwordToken.create({
      data: {
        id: tokenId,
        tenantId,
        userId,
        type: "reset",
        expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        used: false,
      },
    });

    try {
      const mail = buildResetEmail({ name: ut.user?.name, tokenId: token.id });
      await sendEmail({ to: ut.user.email, subject: mail.subject, html: mail.html, text: mail.text });
      logger.info({ userId, email: ut.user.email, tenantId }, "📧 Reset de senha enviado");
    } catch (e) {
      logger.error({ err: e?.message || e, userId, email: ut.user.email, tenantId }, "❌ Falha ao enviar reset de senha");
    }

    return res.json({
      success: true,
      token: { id: token.id, type: token.type, expiresAt: token.expiresAt.toISOString() },
    });
  } catch (e) {
    logger.error({ err: e?.message || e }, "❌ users reset-password error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
