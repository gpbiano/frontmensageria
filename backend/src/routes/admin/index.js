import express from "express";

import adminTenantsRouter from "./adminTenantsRouter.js";
import usersAdminRouter from "./usersAdminRouter.js";
import membershipsAdminRouter from "./membershipsAdminRouter.js";
import bootstrapAdminRouter from "./bootstrapAdminRouter.js";

const router = express.Router();

// health check
router.get("/health", (_req, res) => {
  res.json({ ok: true, scope: "admin" });
});

// tenants (empresas)
router.use("/tenants", adminTenantsRouter);

// users
router.use("/users", usersAdminRouter);

// memberships
router.use("/memberships", membershipsAdminRouter);

// bootstrap
router.use("/bootstrap", bootstrapAdminRouter);

export default router;
