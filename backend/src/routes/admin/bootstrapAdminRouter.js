// backend/src/routes/admin/bootstrapAdminRouter.js
import express from "express";
import { prisma } from "../../lib/prisma.js";

const router = express.Router();

function safeStr(v) {
  return String(v || "").trim();
}

function normalizeEmail(v) {
  return safeStr(v).toLowerCase();
}

function assertBootstrapKey(req) {
  const provided = safeStr(req.headers["x-admin-bootstrap-key"] || req.query.key || req.body?.key);
  const expected = safeStr(process.env.ADMIN_BOOTSTRAP_KEY);
  if (!expected) {
    const err = new Error("ADMIN_BOOTSTRAP_KEY não configurada");
    err.status = 500;
    throw err;
  }
  if (!provided || provided !== expected) {
    const err = new Error("bootstrap_key_invalid");
    err.status = 403;
    throw err;
  }
}

/**
 * POST /admin/bootstrap/superadmin
 * Cria (ou promove) um Super Admin por email.
 *
 * Requer:
 * - Header: X-Admin-Bootstrap-Key: <ADMIN_BOOTSTRAP_KEY>
 *
 * Body:
 * { "email": "voce@dominio.com", "name": "Seu nome" }
 */
router.post("/superadmin", async (req, res) => {
  try {
    assertBootstrapKey(req);

    const email = normalizeEmail(req.body?.email);
    const name = safeStr(req.body?.name) || null;

    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "email inválido" });
    }

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        name,
        role: "admin",
        isActive: true,
        isSuperAdmin: true
      },
      update: {
        name: name || undefined,
        isActive: true,
        isSuperAdmin: true
      }
    });

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        isSuperAdmin: user.isSuperAdmin === true
      }
    });
  } catch (err) {
    const status = Number(err?.status || 500);
    const msg = String(err?.message || "internal_error");
    res.status(status).json({ error: msg });
  }
});

export default router;
