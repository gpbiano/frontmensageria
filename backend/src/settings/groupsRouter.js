// backend/src/settings/groupsRouter.js
import express from "express";
import prisma from "../lib/prisma.js";
import { requireAuth, enforceTokenTenant } from "../middleware/requireAuth.js";

const router = express.Router();

/**
 * Roles permitidas:
 * - admin: tudo
 * - manager: listar + editar (sem criar? aqui deixei criar/editar também, ajuste se quiser)
 * - agent/viewer: somente leitura (se você preferir, dá pra bloquear total)
 */
function requireRole(allowed = []) {
  return (req, res, next) => {
    const role = req.user?.role;
    if (!role) return res.status(401).json({ error: "not_authenticated" });
    if (!allowed.includes(role)) {
      return res.status(403).json({ error: "forbidden", message: "Sem permissão." });
    }
    next();
  };
}

function getTenantId(req) {
  // resolveTenant costuma preencher req.tenant
  const tenantId = req.tenant?.id || req.tenantId;
  return tenantId ? String(tenantId) : null;
}

function normalizeColor(v) {
  if (!v) return null;
  const s = String(v).trim();
  // aceita #RGB/#RRGGBB simples
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s)) return null;
  return s.toLowerCase();
}

function parseSlaMinutes(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

// ✅ LISTAR GRUPOS
// GET /settings/groups?active=true|false|all
router.get(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole(["admin", "manager", "agent", "viewer"]),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const active = String(req.query.active || "true").toLowerCase();
      const where = { tenantId };

      if (active === "true") where.isActive = true;
      else if (active === "false") where.isActive = false;
      // active=all -> sem filtro

      const groups = await prisma.group.findMany({
        where,
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
      });

      res.json({ items: groups, total: groups.length });
    } catch (err) {
      console.error("[groups] list error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ✅ CRIAR GRUPO
// POST /settings/groups
// body: { name, color?, slaMinutes? }
router.post(
  "/",
  requireAuth,
  enforceTokenTenant,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const name = String(req.body?.name || "").trim();
      const color = normalizeColor(req.body?.color) || "#22c55e";
      const slaMinutes = parseSlaMinutes(req.body?.slaMinutes) ?? 10;

      if (!name) {
        return res.status(400).json({ error: "validation_error", message: "name é obrigatório." });
      }

      // Evitar duplicado por tenant (case-insensitive)
      const existing = await prisma.group.findFirst({
        where: {
          tenantId,
          name: { equals: name, mode: "insensitive" },
        },
        select: { id: true },
      });

      if (existing) {
        return res.status(409).json({
          error: "already_exists",
          message: "Já existe um grupo com esse nome.",
        });
      }

      const group = await prisma.group.create({
        data: {
          name,
          color,
          slaMinutes,
          isActive: true,
          tenantId,
        },
      });

      res.status(201).json(group);
    } catch (err) {
      console.error("[groups] create error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ✅ EDITAR GRUPO
// PATCH /settings/groups/:id
// body: { name?, color?, slaMinutes? }
router.patch(
  "/:id",
  requireAuth,
  enforceTokenTenant,
  requireRole(["admin", "manager"]),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      if (!id) return res.status(400).json({ error: "validation_error", message: "id inválido." });

      const patch = {};
      if (req.body?.name !== undefined) {
        const name = String(req.body.name || "").trim();
        if (!name) {
          return res
            .status(400)
            .json({ error: "validation_error", message: "name não pode ser vazio." });
        }
        patch.name = name;
      }
      if (req.body?.color !== undefined) {
        const c = normalizeColor(req.body.color);
        if (!c) {
          return res
            .status(400)
            .json({ error: "validation_error", message: "color inválida. Use #RGB ou #RRGGBB." });
        }
        patch.color = c;
      }
      if (req.body?.slaMinutes !== undefined) {
        const sla = parseSlaMinutes(req.body.slaMinutes);
        if (sla === null) {
          return res
            .status(400)
            .json({ error: "validation_error", message: "slaMinutes inválido." });
        }
        patch.slaMinutes = sla;
      }

      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "validation_error", message: "Nada para atualizar." });
      }

      // Confere se existe no tenant
      const current = await prisma.group.findFirst({
        where: { id, tenantId },
      });
      if (!current) return res.status(404).json({ error: "not_found" });

      // Se mudou nome, checa duplicado no tenant
      if (patch.name) {
        const dup = await prisma.group.findFirst({
          where: {
            tenantId,
            id: { not: id },
            name: { equals: patch.name, mode: "insensitive" },
          },
          select: { id: true },
        });
        if (dup) {
          return res.status(409).json({
            error: "already_exists",
            message: "Já existe um grupo com esse nome.",
          });
        }
      }

      const updated = await prisma.group.update({
        where: { id },
        data: patch,
      });

      res.json(updated);
    } catch (err) {
      console.error("[groups] patch error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ✅ DESATIVAR
// PATCH /settings/groups/:id/deactivate
router.patch(
  "/:id/deactivate",
  requireAuth,
  enforceTokenTenant,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      const group = await prisma.group.findFirst({ where: { id, tenantId } });
      if (!group) return res.status(404).json({ error: "not_found" });

      const updated = await prisma.group.update({
        where: { id },
        data: { isActive: false },
      });

      res.json(updated);
    } catch (err) {
      console.error("[groups] deactivate error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

// ✅ ATIVAR
// PATCH /settings/groups/:id/activate
router.patch(
  "/:id/activate",
  requireAuth,
  enforceTokenTenant,
  requireRole(["admin"]),
  async (req, res) => {
    try {
      const tenantId = getTenantId(req);
      if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

      const id = String(req.params.id || "").trim();
      const group = await prisma.group.findFirst({ where: { id, tenantId } });
      if (!group) return res.status(404).json({ error: "not_found" });

      const updated = await prisma.group.update({
        where: { id },
        data: { isActive: true },
      });

      res.json(updated);
    } catch (err) {
      console.error("[groups] activate error:", err);
      res.status(500).json({ error: "internal_error" });
    }
  }
);

export default router;
