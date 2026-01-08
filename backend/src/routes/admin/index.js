// backend/src/routes/admin/index.js
import express from "express";
import tenantsAdminRouter from "./adminTenantsRouter.js";
import usersAdminRouter from "./usersAdminRouter.js";
import membershipsAdminRouter from "./membershipsAdminRouter.js";

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ ok: true, module: "admin" });
});

router.use("/tenants", tenantsAdminRouter);
router.use("/users", usersAdminRouter);
router.use("/tenants/:tenantId/members", membershipsAdminRouter);

export default router;
