// backend/src/routes/admin/index.js
import express from "express";
import tenantsAdminRouter from "./tenantsAdminRouter.js";
import usersAdminRouter from "./usersAdminRouter.js";
import membershipsAdminRouter from "./membershipsAdminRouter.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, module: "admin" });
});

// Tenants (inclui billing/companyProfile + billing sync)
router.use("/tenants", tenantsAdminRouter);

// Users (Super Admin gerencia usuários globais)
router.use("/users", usersAdminRouter);

// Memberships por tenant (admin adiciona/remove usuários do tenant)
router.use("/tenants/:tenantId/members", membershipsAdminRouter);

export default router;
