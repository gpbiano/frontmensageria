// backend/src/settings/usersRouter.js
import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { sendEmail } from "../email/resendClient.js";
import logger from "../logger.js";

const router = express.Router();

// Base do app (onde fica a rota /criar-senha)
// importante: remove barra final para evitar //criar-senha
const APP_BASE_URL = String(
  process.env.APP_BASE_URL || "http://localhost:5173"
).replace(/\/+$/, "");

// 24h
const INVITE_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// roles oficiais
const ROLES = ["admin", "manager", "agent", "viewer"];

function nowIso() {
  return new Date().toISOString();
}

function newTokenId(prefix = "tok") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function nextUserId(users) {
  const ids = (users || []).map((u) => Number(u.id) || 0);
  return (ids.length ? Math.max(...ids) : 0) + 1;
}

function sanitizeUser(u) {
  if (!u) return u;
  const { password, passwordHash, ...rest } = u;
  // normaliza isActive para boolean (default true)
  return { ...rest, isActive: rest.isActive !== false };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidRole(role) {
  return ROLES.includes(String(role || "").trim());
}

function ensureDbArrays(db) {
  db.users = ensureArray(db.users);
  db.passwordTokens = ensureArray(db.passwordTokens);
  return db;
}

function invalidateUserTokens(db, userId, reason = "invalidated") {
  const now = nowIso();
  for (const t of db.passwordTokens || []) {
    if (Number(t.userId) === Number(userId) && t.used !== true) {
      t.used = true;
      t.usedAt = now;
      t.invalidatedReason = reason;
    }
  }
}

function buildInviteEmail({ name, tokenId }) {
  const link = `${APP_BASE_URL}/criar-senha?token=${encodeURIComponent(tokenId)}`;
  const subject = "GP Labs — Crie sua senha de acesso";

  const text =
    `Olá${name ? `, ${name}` : ""}!\n\n` +
    `Para acessar a plataforma, crie sua senha pelo link:\n${link}\n\n` +
    `Este link expira em 24h.\n\n` +
    `Se você não solicitou isso, ignore este e-mail.`;

  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.4;color:#111">
    <h2 style="margin:0 0 12px;">GP Labs — Criar senha</h2>
    <p>Olá${name ? `, <b>${name}</b>` : ""}!</p>
    <p>Para acessar a plataforma, clique no botão abaixo para criar sua senha:</p>
    <p style="margin:18px 0;">
      <a href="${link}" style="background:#10b981;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;display:inline-block;">
        Criar senha
      </a>
    </p>
    <p style="color:#555;font-size:13px;">Este link expira em 24h.</p>
    <p style="color:#777;font-size:12px;margin-top:18px;">Se você não solicitou isso, ignore este e-mail.</p>
  </div>`;

  return { subject, text, html, link };
}

function buildResetEmail({ name, tokenId }) {
  const link = `${APP_BASE_URL}/criar-senha?token=${encodeURIComponent(tokenId)}`;
  const subject = "GP Labs — Redefinição de senha";

  const text =
    `Olá${name ? `, ${name}` : ""}!\n\n` +
    `Você solicitou redefinir sua senha. Use o link:\n${link}\n\n` +
    `Este link expira em 24h.\n\n` +
    `Se não foi você, ignore este e-mail.`;

  const html = `
  <div style="font-family:Arial,sans-serif;line-height:1.4;color:#111">
    <h2 style="margin:0 0 12px;">GP Labs — Redefinir senha</h2>
    <p>Olá${name ? `, <b>${name}</b>` : ""}!</p>
    <p>Use o botão abaixo para redefinir sua senha:</p>
    <p style="margin:18px 0;">
      <a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;display:inline-block;">
        Redefinir senha
      </a>
    </p>
    <p style="color:#555;font-size:13px;">Este link expira em 24h.</p>
    <p style="color:#777;font-size:12px;margin-top:18px;">Se não foi você, ignore este e-mail.</p>
  </div>`;

  return { subject, text, html, link };
}

/**
 * GET /settings/users
 * (admin/manager) - lista usuários sanitizados
 */
router.get("/users", requireAuth, requireRole(["admin", "manager"]), (req, res) => {
  const db = ensureDbArrays(loadDB());
  const users = (db.users || []).map(sanitizeUser);
  return res.json({ data: users, total: users.length });
});

/**
 * POST /settings/users
 * (admin) - cria usuário + token invite + envia e-mail
 * body: { name, email, role }
 */
router.post("/users", requireAuth, requireRole(["admin"]), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const role = String(req.body?.role || "agent").trim();

  if (!name) return res.status(400).json({ error: "Nome é obrigatório." });
  if (!email) return res.status(400).json({ error: "E-mail é obrigatório." });
  if (!isValidEmail(email)) return res.status(400).json({ error: "E-mail inválido." });
  if (!isValidRole(role)) return res.status(400).json({ error: `Role inválida: ${role}` });

  const db = ensureDbArrays(loadDB());

  const exists = (db.users || []).some((u) => normalizeEmail(u.email) === email);
  if (exists) return res.status(409).json({ error: "Já existe usuário com este e-mail." });

  const user = {
    id: nextUserId(db.users),
    name,
    email,
    role,
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.users.push(user);

  // token de convite
  const tokenId = newTokenId("invite");
  const token = {
    id: tokenId,
    userId: user.id,
    type: "invite",
    expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString(),
    used: false,
    createdAt: nowIso()
  };

  db.passwordTokens.push(token);
  saveDB(db);

  // envia e-mail (se falhar, usuário continua criado)
  try {
    const mail = buildInviteEmail({ name: user.name, tokenId });
    await sendEmail({
      to: user.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    });
    logger.info({ userId: user.id, email: user.email, role: user.role }, "📧 Convite enviado (criar senha)");
  } catch (e) {
    logger.error({ err: e?.message || e, userId: user.id, email: user.email }, "❌ Falha ao enviar convite");
  }

  return res.status(201).json({
    success: true,
    user: sanitizeUser(user),
    token: { id: tokenId, type: "invite", expiresAt: token.expiresAt }
  });
});

/**
 * PATCH /settings/users/:id
 * (admin/manager) - edita name/role/isActive
 */
router.patch("/users/:id", requireAuth, requireRole(["admin", "manager"]), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const db = ensureDbArrays(loadDB());
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  const hasName = Object.prototype.hasOwnProperty.call(req.body || {}, "name");
  const hasRole = Object.prototype.hasOwnProperty.call(req.body || {}, "role");
  const hasIsActive = Object.prototype.hasOwnProperty.call(req.body || {}, "isActive");

  if (hasName) {
    const newName = String(req.body?.name || "").trim();
    if (!newName) return res.status(400).json({ error: "Nome inválido." });
    user.name = newName;
  }

  if (hasRole) {
    const newRole = String(req.body?.role || "").trim();

    // manager não pode promover para admin
    if (req.user?.role === "manager" && newRole === "admin") {
      return res.status(403).json({ error: "Manager não pode promover para admin." });
    }

    if (!isValidRole(newRole)) return res.status(400).json({ error: `Role inválida: ${newRole}` });
    user.role = newRole;
  }

  if (hasIsActive) {
    const active = Boolean(req.body?.isActive);
    user.isActive = active;

    if (active === false) {
      invalidateUserTokens(db, user.id, "user_deactivated");
    }
  }

  user.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, user: sanitizeUser(user) });
});

/**
 * PATCH /settings/users/:id/deactivate
 * (admin) - soft delete + invalida tokens pendentes
 */
router.patch("/users/:id/deactivate", requireAuth, requireRole(["admin"]), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const db = ensureDbArrays(loadDB());
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  user.isActive = false;
  user.updatedAt = nowIso();

  invalidateUserTokens(db, user.id, "user_deactivated");

  saveDB(db);

  return res.json({ success: true, user: sanitizeUser(user) });
});

/**
 * POST /settings/users/:id/reset-password
 * (admin) - gera token reset + envia e-mail
 */
router.post("/users/:id/reset-password", requireAuth, requireRole(["admin"]), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const db = ensureDbArrays(loadDB());
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  if (user.isActive === false) return res.status(400).json({ error: "Usuário inativo." });

  // invalida resets pendentes antigos
  invalidateUserTokens(db, user.id, "new_reset_requested");

  const tokenId = newTokenId("reset");
  const token = {
    id: tokenId,
    userId: user.id,
    type: "reset",
    expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS).toISOString(),
    used: false,
    createdAt: nowIso()
  };

  db.passwordTokens.push(token);
  saveDB(db);

  try {
    const mail = buildResetEmail({ name: user.name, tokenId });
    await sendEmail({
      to: user.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text
    });

    logger.info({ userId: user.id, email: user.email }, "📧 Reset de senha enviado");
  } catch (e) {
    logger.error({ err: e?.message || e, userId: user.id, email: user.email }, "❌ Falha ao enviar reset de senha");
  }

  return res.json({
    success: true,
    token: { id: tokenId, type: "reset", expiresAt: token.expiresAt }
  });
});

export default router;

