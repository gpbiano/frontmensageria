// backend/src/index.js

// ===============================
// IMPORTS (core/libs)
// ===============================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";

import { resolveTenant } from "./middleware/resolveTenant.js";
import { requireTenant } from "./middleware/requireTenant.js";
import { requireAuth, enforceTokenTenant } from "./middleware/requireAuth.js";

// ===============================
// PATHS + ENV LOAD
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

const envProdPath = path.join(__dirname, "..", ".env.production");
const envDevPath = path.join(__dirname, "..", ".env");

if (ENV === "production" && fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath });
} else if (fs.existsSync(envDevPath)) {
  dotenv.config({ path: envDevPath });
} else if (fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath });
}

// Compat WhatsApp ENV
process.env.TENANT_BASE_DOMAIN ||= "cliente.gplabs.com.br";

// ===============================
// LOGGER
// ===============================
const { default: logger } = await import("./logger.js");

// ===============================
// PRISMA
// ===============================
let prisma;
let prismaReady = false;

try {
  const mod = await import("./lib/prisma.js");
  prisma = mod?.default || mod?.prisma;

  prismaReady = !!(prisma?.user && prisma?.tenant && prisma?.userTenant);

  logger.info({ prismaReady }, "Prisma status");
} catch (err) {
  prismaReady = false;
  logger.error({ err }, "Erro ao carregar Prisma");
}

// ===============================
// ROUTERS
// ===============================
const { default: passwordRouter } = await import("./auth/passwordRouter.js");

const { default: usersRouter } = await import("./settings/usersRouter.js");
const { default: groupsRouter } = await import("./settings/groupsRouter.js");
const { default: channelsRouter } = await import("./routes/channels.js");

const { default: chatbotRouter } = await import("./chatbot/chatbotRouter.js");
const { default: humanRouter } = await import("./human/humanRouter.js");
const { default: assignmentRouter } = await import("./human/assignmentRouter.js");

const { default: webchatRouter } = await import("./routes/webchat.js");
const { default: conversationsRouter } = await import("./routes/conversations.js");

const { default: outboundRouter } = await import("./outbound/outboundRouter.js");
const { default: numbersRouter } = await import("./outbound/numbersRouter.js");
const { default: templatesRouter } = await import("./outbound/templatesRouter.js");
const { default: assetsRouter } = await import("./outbound/assetsRouter.js");
const { default: campaignsRouter } = await import("./outbound/campaignsRouter.js");
const { default: optoutRouter } = await import("./outbound/optoutRouter.js");
const { default: smsCampaignsRouter } = await import("./outbound/smsCampaignsRouter.js");

const { default: whatsappRouter } = await import("./routes/channels/whatsappRouter.js");
const { verifyPassword } = await import("./security/passwords.js");

// ===============================
// VARS
// ===============================
const PORT = process.env.PORT || 3010;

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
if (!JWT_SECRET) throw new Error("JWT_SECRET não definido");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ===============================
// APP
// ===============================
const app = express();
app.set("etag", false);

// ===============================
// LOGGER HTTP
// ===============================
app.use(
  pinoHttp({
    logger,
    quietReqLogger: true,
  })
);

// ===============================
// CORS
// ===============================
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

// ===============================
// TENANT RESOLUTION
// ===============================
app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: [
      "/",
      "/health",
      "/login",
      "/auth/password",
      "/auth/select-tenant",
      "/webhook/whatsapp",
      "/webchat",
    ],
  })
);

// ===============================
// HELPERS
// ===============================
function requirePrisma(req, res, next) {
  if (prismaReady) return next();
  return res.status(503).json({ error: "DB not ready" });
}

// ===============================
// 🌍 ROTAS PÚBLICAS
// ===============================

// 🔐 Criar / redefinir senha (PÚBLICO)
app.use("/auth", passwordRouter);

// 🌐 Webchat
app.use("/webchat", webchatRouter);

// ❤️ Health
app.get("/", (req, res) => res.json({ status: "ok" }));
app.get("/health", async (req, res) => {
  const users = prismaReady ? await prisma.user.count() : 0;
  const tenants = prismaReady ? await prisma.tenant.count() : 0;

  res.json({ ok: true, prismaReady, users, tenants, uptime: process.uptime() });
});

// ===============================
// 🔐 LOGIN
// ===============================
app.post("/login", requirePrisma, async (req, res) => {
  const { email, password } = req.body || {};

  const user = await prisma.user.findFirst({
    where: { email, isActive: true },
    include: { tenants: { include: { tenant: true } } },
  });

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return res.status(401).json({ error: "Credenciais inválidas." });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ token, user });
});

// ===============================
// 🔐 SELEÇÃO DE TENANT
// ===============================
app.post("/auth/select-tenant", requireAuth, requirePrisma, async (req, res) => {
  const { organizationId } = req.body;

  const tenant = await prisma.tenant.findUnique({
    where: { id: organizationId },
  });

  if (!tenant) return res.status(404).json({ error: "Tenant inválido." });

  const token = jwt.sign(
    {
      id: req.user.id,
      email: req.user.email,
      tenantId: tenant.id,
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );

  res.json({ token, tenant });
});

// ===============================
// 🔒 MIDDLEWARE GLOBAL (PROTEGIDO)
// ===============================
app.use(requireAuth);
app.use(enforceTokenTenant);
app.use(requireTenant);
app.use(requirePrisma);

// ===============================
// 🔒 ROTAS PROTEGIDAS
// ===============================
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

app.use("/conversations", conversationsRouter);

app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);
app.use("/outbound/optout", optoutRouter);
app.use("/outbound/sms-campaigns", smsCampaignsRouter);
app.use("/outbound", outboundRouter);

// ===============================
// WEBHOOK (PÚBLICO)
// ===============================
app.use("/webhook/whatsapp", whatsappRouter);

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err, url: req.url }, "Erro não tratado");
  res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT, ENV, prismaReady }, "🚀 API rodando");
});
