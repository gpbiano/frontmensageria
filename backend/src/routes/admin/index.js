// backend/src/routes/admin/index.js
import express from "express";

import adminTenantsRouter from "./adminTenantsRouter.js";
// Se você tiver outros routers admin, importe aqui também, ex:
// import usersAdminRouter from "./usersAdminRouter.js";
// import membershipsAdminRouter from "./membershipsAdminRouter.js";
// import bootstrapAdminRouter from "./bootstrapAdminRouter.js";

const router = express.Router();

// ✅ rota atual (funcionando)
router.use("/tenants", adminTenantsRouter);

// ✅ alias novo (front usa /cadastros)
router.use("/cadastros", adminTenantsRouter);

// (Opcional) outros routers admin
// router.use("/users", usersAdminRouter);
// router.use("/memberships", membershipsAdminRouter);
// router.use("/bootstrap", bootstrapAdminRouter);

export default router;
