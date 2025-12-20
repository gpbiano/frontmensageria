// backend/src/auth/select-tenant.js

import express from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

// ===============================
// SELECT ORGANIZATION (pós-login)
// ===============================
router.post("/select-tenant", requireAuth, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};

    if (!organizationId) {
      return res.status(400).json({ error: "Informe a organização." });
    }

    const org = await prisma.tenant.findUnique({
      where: { id: organizationId },
      select: { id: true, isActive: true }
    });

    if (!org || !org.isActive) {
      return res.status(404).json({ error: "Organização inválida." });
    }

    // Super admin pode tudo
    if (req.user.scope !== "global") {
      const membership = await prisma.userTenant.findFirst({
        where: {
          userId: req.user.id,
          tenantId: org.id,
          isActive: true
        },
        select: { role: true }
      });

      if (!membership) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      req.user.role = membership.role;
    }

    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        tenantId: org.id
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    return res.json({ token });
  } catch (e) {
    next(e);
  }
});

export default router;
