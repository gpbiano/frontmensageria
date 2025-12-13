// backend/src/settings/usersRouter.js
import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import { sendEmail } from "../email/resendClient.js";
import logger from "../logger.js";

const router = express.Router();

// ⚠️ ESTE ROUTER TEM PATHS INTERNOS "/users"
// então o mount correto no index é:
// app.use("/settings", usersRouter);

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
  return { ...rest, isActive: rest.isActive !== false };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidRole(role) {
  return ROLES.includes(String(role || "").trim().toLowerCase());
}

function ensureDbArrays(db) {
  db.users = ensureArray(db.users);
  db.passwordTokens = ensureArray(db.passwordTokens);
  return db;
}

function parseBoolean(v) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
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

  const preheader =
    "Ative seu acesso à plataforma GP Labs e crie sua senha em poucos segundos.";

  const text =
    `Olá${name ? `, ${name}` : ""}!\n\n` +
    `Bem-vindo(a) à GP Labs.\n` +
    `Para ativar seu usuário e criar sua senha, acesse:\n${link}\n\n` +
    `Este link expira em 24h.\n\n` +
    `Se você não solicitou isso, ignore este e-mail.`;

  const html = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>GP Labs — Criar senha</title>
</head>
<body style="margin:0;padding:0;background:#0b1020;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${preheader}
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#0b1020;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table width="640" cellpadding="0" cellspacing="0" role="presentation" style="max-width:100%;border-radius:18px;overflow:hidden;background:#070b18;border:1px solid rgba(255,255,255,0.10);">

          <tr>
            <td style="padding:26px 24px;background:
              radial-gradient(1200px 500px at 20% 10%, rgba(34,197,94,0.25), rgba(11,16,32,0) 60%),
              linear-gradient(135deg,#020617,#0b1020);">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <img
                      src="${APP_BASE_URL}/gp-labs-logo.png"
                      alt="GP Labs"
                      width="120"
                      style="display:block;border:0;outline:none;"
                    />
                  </td>
                  <td align="right" valign="middle">
                    <span style="display:inline-block;padding:6px 12px;border-radius:999px;
                      background:rgba(34,197,94,0.15);
                      border:1px solid rgba(34,197,94,0.35);
                      color:#86efac;
                      font-family:Arial,sans-serif;
                      font-size:12px;">
                      Convite
                    </span>
                  </td>
                </tr>
              </table>

              <h1 style="margin:22px 0 10px;color:#e5e7eb;font-family:Arial,sans-serif;font-size:26px;font-weight:800;">
                Bem-vindo(a)${name ? `, ${name}` : ""} 👋
              </h1>

              <p style="margin:0;color:#cbd5e1;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;">
                Você foi adicionado(a) à plataforma da <b>GP Labs</b>.
                Para ativar seu usuário e criar sua senha de acesso, clique no botão abaixo.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:24px;">
              <a href="${link}" style="
                display:inline-block;
                background:#22c55e;
                color:#052e1a;
                text-decoration:none;
                font-family:Arial,sans-serif;
                font-weight:800;
                font-size:14px;
                padding:14px 18px;
                border-radius:12px;">
                Criar senha
              </a>

              <p style="margin:18px 0 0;color:#94a3b8;font-family:Arial,sans-serif;font-size:13px;line-height:1.6;">
                Este link expira em <b>24 horas</b>. Se você não solicitou isso, pode ignorar este e-mail com segurança.
              </p>

              <div style="margin-top:16px;padding:14px;border-radius:14px;
                background:rgba(255,255,255,0.04);
                border:1px solid rgba(255,255,255,0.08);">
                <p style="margin:0;color:#cbd5e1;font-family:Arial,sans-serif;font-size:12px;">
                  Se o botão não funcionar, copie e cole este link no navegador:
                </p>
                <p style="margin:8px 0 0;color:#e5e7eb;font-family:Arial,sans-serif;font-size:12px;word-break:break-all;">
                  ${link}
                </p>
              </div>
            </td>
          </tr>

          <tr>
            <td style="padding:20px 24px;border-top:1px solid rgba(255,255,255,0.08);background:#050816;">
              <p style="margin:0;color:#94a3b8;font-family:Arial,sans-serif;font-size:12px;">
                © ${new Date().getFullYear()} GP Labs. Todos os direitos reservados.
              </p>
              <p style="margin:8px 0 0;color:#64748b;font-family:Arial,sans-serif;font-size:11px;">
                Não quer mais receber e-mails?
                <span style="color:#e5e7eb;text-decoration:underline;">
                  Cancelar recebimento
                </span>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html, link };
}

function buildResetEmail({ name, tokenId }) {
  const link = `${APP_BASE_URL}/criar-senha?token=${encodeURIComponent(tokenId)}`;
  const subject = "GP Labs — Redefinição de senha";

  const text =
    `Olá${name ? `, ${name}` : ""}!\n\n` +
    `Recebemos uma solicitação de redefinição de senha.\n` +
    `Para continuar, acesse:\n${link}\n\n` +
    `Este link expira em 24h.\n\n` +
    `Se não foi você, ignore este e-mail.`;

  const html = buildInviteEmail({ name, tokenId }).html
    .replace("Convite", "Redefinição")
    .replace("Bem-vindo(a)", "Redefinir senha")
    .replace(">Criar senha<", ">Redefinir senha<")
    .replace(
      "Para ativar seu usuário e criar sua senha de acesso, clique no botão abaixo.",
      "Recebemos uma solicitação para redefinir sua senha de acesso. Para continuar, clique no botão abaixo."
    );

  return { subject, text, html, link };
}

/**
 * GET /settings/users
 * (admin/manager) - lista usuários sanitizados
 */
router.get("/users", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = ensureDbArrays(loadDB());
  const users = (db.users || []).map(sanitizeUser);
  return res.json({ data: users, total: users.length });
});

/**
 * GET /settings/users/:id
 * (admin/manager) - pega 1 usuário
 */
router.get("/users/:id", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const db = ensureDbArrays(loadDB());
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  return res.json({ user: sanitizeUser(user) });
});

/**
 * POST /settings/users
 * (admin) - cria usuário + token invite + envia e-mail
 * body: { name, email, role }
 */
router.post("/users", requireAuth, requireRole("admin"), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const email = normalizeEmail(req.body?.email);
  const role = String(req.body?.role || "agent").trim().toLowerCase();

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
router.patch("/users/:id", requireAuth, requireRole("admin", "manager"), (req, res) => {
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
    const newRole = String(req.body?.role || "").trim().toLowerCase();

    // manager não pode promover para admin
    if (req.user?.role === "manager" && newRole === "admin") {
      return res.status(403).json({ error: "Manager não pode promover para admin." });
    }

    if (!isValidRole(newRole)) return res.status(400).json({ error: `Role inválida: ${newRole}` });
    user.role = newRole;
  }

  if (hasIsActive) {
    const parsed = parseBoolean(req.body?.isActive);
    if (parsed === undefined) {
      return res.status(400).json({ error: "isActive inválido (use true/false)." });
    }
    user.isActive = parsed;

    if (parsed === false) invalidateUserTokens(db, user.id, "user_deactivated");
  }

  user.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, user: sanitizeUser(user) });
});

/**
 * PATCH /settings/users/:id/deactivate
 * (admin) - soft delete + invalida tokens pendentes
 */
router.patch("/users/:id/deactivate", requireAuth, requireRole("admin"), (req, res) => {
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
 * PATCH /settings/users/:id/activate
 * (admin) - reativa usuário
 */
router.patch("/users/:id/activate", requireAuth, requireRole("admin"), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "ID inválido." });

  const db = ensureDbArrays(loadDB());
  const user = (db.users || []).find((u) => Number(u.id) === id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  user.isActive = true;
  user.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, user: sanitizeUser(user) });
});

/**
 * POST /settings/users/:id/reset-password
 * (admin) - gera token reset + envia e-mail
 */
router.post("/users/:id/reset-password", requireAuth, requireRole("admin"), async (req, res) => {
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
