// backend/src/settings/usersRouter.js
import express from "express";
import logger from "../logger.js";
import { requireAuth, requireAdmin } from "../auth/authMiddleware.js";

const router = express.Router();

const ROLES = ["admin", "gerente", "atendente", "visualizador"];

function nowIso() {
  return new Date().toISOString();
}

function sanitizeUser(u) {
  if (!u) return null;
  const { password, ...safe } = u;
  return safe;
}

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function getNextUserId(state) {
  const ids = (state.users || []).map((u) => Number(u.id) || 0);
  const max = ids.length ? Math.max(...ids) : 0;
  return max + 1;
}

function countAdmins(state) {
  return (state.users || []).filter((u) => (u.role || "admin") === "admin" && u.isActive !== false).length;
}

function findMe(state, req) {
  const myId = Number(req.user?.id);
  return (state.users || []).find((u) => Number(u.id) === myId) || null;
}

/**
 * GET /settings/users
 * Lista usuários (sem password)
 */
router.get("/", requireAuth, requireAdmin, (req, res) => {
  try {
    const state = req.state;
    const users = (state.users || []).map(sanitizeUser);
    return res.json({ items: users });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao listar usuários");
    return res.status(500).json({ error: "Erro ao listar usuários." });
  }
});

/**
 * POST /settings/users
 * Cria usuário
 */
router.post("/", requireAuth, requireAdmin, (req, res) => {
  try {
    const state = req.state;

    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "").trim();
    const role = String(req.body?.role || "atendente").trim();
    const isActive = req.body?.isActive !== false;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Informe nome, e-mail e senha." });
    }

    if (!ROLES.includes(role)) {
      return res.status(400).json({ error: `Role inválida. Use: ${ROLES.join(", ")}.` });
    }

    state.users = state.users || [];

    const exists = state.users.some((u) => normalizeEmail(u.email) === email);
    if (exists) {
      return res.status(409).json({ error: "Já existe um usuário com esse e-mail." });
    }

    const id = getNextUserId(state);
    const t = nowIso();

    const user = {
      id,
      name,
      email,
      password, // DEV (texto puro) — depois trocamos por hash
      role,
      isActive,
      createdAt: t,
      updatedAt: t
    };

    state.users.push(user);
    req.saveState();

    logger.info({ userId: id, email, role }, "✅ Usuário criado");
    return res.status(201).json({ item: sanitizeUser(user) });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao criar usuário");
    return res.status(500).json({ error: "Erro ao criar usuário." });
  }
});

/**
 * PATCH /settings/users/:id
 * Edita usuário (nome, role, status)
 * (senha NÃO aqui — tem endpoint próprio de reset)
 */
router.patch("/:id", requireAuth, requireAdmin, (req, res) => {
  try {
    const state = req.state;
    const id = Number(req.params.id);

    const user = (state.users || []).find((u) => Number(u.id) === id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    const name = req.body?.name != null ? String(req.body.name).trim() : null;
    const role = req.body?.role != null ? String(req.body.role).trim() : null;
    const isActive = req.body?.isActive;

    // Regras
    if (role && !ROLES.includes(role)) {
      return res.status(400).json({ error: `Role inválida. Use: ${ROLES.join(", ")}.` });
    }

    // impedir remover o último admin ativo
    if (user.role === "admin" && role && role !== "admin") {
      const admins = countAdmins(state);
      if (admins <= 1) {
        return res.status(400).json({ error: "Não é possível remover o último administrador." });
      }
    }

    // impede desativar o último admin ativo
    if (user.role === "admin" && isActive === false) {
      const admins = countAdmins(state);
      if (admins <= 1) {
        return res.status(400).json({ error: "Não é possível desativar o último administrador." });
      }
    }

    if (name !== null) user.name = name;
    if (role !== null) user.role = role;
    if (typeof isActive === "boolean") user.isActive = isActive;

    user.updatedAt = nowIso();
    req.saveState();

    logger.info({ userId: id }, "✅ Usuário atualizado");
    return res.json({ item: sanitizeUser(user) });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao editar usuário");
    return res.status(500).json({ error: "Erro ao editar usuário." });
  }
});

/**
 * POST /settings/users/:id/reset-password
 * Resetar senha (admin-only)
 */
router.post("/:id/reset-password", requireAuth, requireAdmin, (req, res) => {
  try {
    const state = req.state;
    const id = Number(req.params.id);

    const newPassword = String(req.body?.newPassword || "").trim();
    if (!newPassword || newPassword.length < 4) {
      return res.status(400).json({ error: "Informe uma nova senha (mínimo 4 caracteres)." });
    }

    const user = (state.users || []).find((u) => Number(u.id) === id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    user.password = newPassword; // DEV
    user.updatedAt = nowIso();
    req.saveState();

    logger.info({ userId: id }, "🔐 Senha resetada");
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao resetar senha");
    return res.status(500).json({ error: "Erro ao resetar senha." });
  }
});

/**
 * DELETE /settings/users/:id
 * Soft delete: isActive=false
 */
router.delete("/:id", requireAuth, requireAdmin, (req, res) => {
  try {
    const state = req.state;
    const id = Number(req.params.id);

    const me = findMe(state, req);

    const user = (state.users || []).find((u) => Number(u.id) === id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    // não deixa deletar a si mesmo
    if (me && Number(me.id) === id) {
      return res.status(400).json({ error: "Você não pode desativar a si mesmo." });
    }

    // impedir desativar último admin
    if ((user.role || "admin") === "admin") {
      const admins = countAdmins(state);
      if (admins <= 1) {
        return res.status(400).json({ error: "Não é possível desativar o último administrador." });
      }
    }

    user.isActive = false;
    user.updatedAt = nowIso();
    req.saveState();

    logger.info({ userId: id }, "🧊 Usuário desativado (soft delete)");
    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro ao desativar usuário");
    return res.status(500).json({ error: "Erro ao desativar usuário." });
  }
});

export default router;
