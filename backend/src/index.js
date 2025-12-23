// backend/src/index.js
// ✅ PRISMA-FIRST (sem data.json)
// Index consolidado: tenant resolve -> rotas públicas -> auth global -> tenant guard -> prisma guard -> rotas protegidas

// ===============================
// IMPORTS (core/libs)
// ===============================
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pinoHttp from "pino-http";

// Middlewares
import { resolveTenant } from "./middleware/resolveTenant.js";
import { requireTenant } from "./middleware/requireTenant.js";
import { requireAuth, enforceTokenTenant } from "./middleware/requireAuth.js";

// ===============================
// PATHS + ENV LOAD (FIX DEFINITIVO)
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

const envProdPath = path.join(__dirname, "..", ".env.production");
const envDevPath = path.join(__dirname, "..", ".env");

/**
 * ✅ FIX DEFINITIVO:
 * Em produção, força .env.production sobrescrever qualquer ENV injetada pelo PM2/system.
 * Isso evita regressão do META_EMBEDDED_REDIRECT_URI e outros.
 */
if (ENV === "production" && fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath, override: true });
} else if (fs.existsSync(envDevPath)) {
  dotenv.config({ path: envDevPath, override: false });
} else if (fs.existsSync(envProdPath)) {
  // fallback (caso dev sem .env)
  dotenv.config({ path: envProdPath, override: false });
}

// Base domain (tenant por subdomínio)
process.env.TENANT_BASE_DOMAIN ||= "cliente.gplabs.com.br";

// Tenant fallback para webhook (opcional)
process.env.WHATSAPP_DEFAULT_TENANT_ID ||= String(
  process.env.WHATSAPP_DEFAULT_TENANT_ID || ""
).trim();

// ===============================
// LOGGER
// ===============================
const { default: logger } = await import("./logger.js");

// 🔎 Log rápido do env efetivo (pode remover depois)
logger.info(
  {
    ENV,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
    META_EMBEDDED_REDIRECT_URI: process.env.META_EMBEDDED_REDIRECT_URI || null
  },
  "🧩 Env carregado"
);

// ===============================
// PRISMA
// ===============================
let prisma = null;
let prismaReady = false;

try {
  const mod = await import("./lib/prisma.js");
  prisma = mod?.prisma || mod?.default || mod;

  prismaReady = !!(
    prisma?.user &&
    prisma?.tenant &&
    prisma?.userTenant &&
    prisma?.conversation &&
    prisma?.message
  );

  logger.info(
    {
      prismaReady,
      tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
      hasWhatsappDefaultTenant: !!process.env.WHATSAPP_DEFAULT_TENANT_ID
    },
    "🧠 Prisma status"
  );
} catch (err) {
  prismaReady = false;
  logger.error({ err }, "❌ Erro ao carregar Prisma");
}

// ===============================
// ROUTERS
// ===============================

// 🔐 Auth
const { default: authRouter } = await import("./auth/authRouter.js");
const { default: passwordRouter } = await import("./auth/passwordRouter.js");

// ⚙️ Settings
const { default: usersRouter } = await import("./settings/usersRouter.js");
const { default: groupsRouter } = await import("./settings/groupsRouter.js");
const { default: channelsRouter } = await import("./routes/channels.js");
// ⬆️ aqui ficam:
// - /settings/channels
// - /settings/channels/whatsapp/start
// - /settings/channels/whatsapp/callback
// - /settings/channels/whatsapp (DELETE)

// 🤖 Atendimento
const { default: chatbotRouter } = await import("./chatbot/chatbotRouter.js");
const { default: humanRouter } = await import("./human/humanRouter.js");
const { default: assignmentRouter } = await import("./human/assignmentRouter.js");

// 💬 Webchat + Conversas
const { default: webchatRouter } = await import("./routes/webchat.js");
const { default: conversationsRouter } = await import("./routes/conversations.js");

// 📤 Outbound
const { default: outboundRouter } = await import("./outbound/outboundRouter.js");
const { default: numbersRouter } = await import("./outbound/numbersRouter.js");
const { default: templatesRouter } = await import("./outbound/templatesRouter.js");
const { default: assetsRouter } = await import("./outbound/assetsRouter.js");
const { default: campaignsRouter } = await import("./outbound/campaignsRouter.js");
const { default: optoutRouter } = await import("./outbound/optoutRouter.js");
const { default: smsCampaignsRouter } = await import("./outbound/smsCampaignsRouter.js");

// 📡 WhatsApp Webhook (EVENTOS / MENSAGENS)
// ⚠️ NÃO CONFUNDIR COM SETTINGS
const { default: whatsappRouter } = await import(
  "./routes/channels/whatsappRouter.js"
);

// ===============================
// VARS
// ===============================
const PORT = Number(process.env.PORT || 3010);

// ===============================
// APP
// ===============================
const app = express();
app.set("etag", false);
app.disable("x-powered-by");

// ===============================
// LOGGER HTTP
// ===============================
app.use(
  pinoHttp({
    logger,
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) =>
        req.method === "OPTIONS" ||
        req.url.startsWith("/health") ||
        req.url.startsWith("/webhook/whatsapp")
    }
  })
);

// ===============================
// CORS + PARSERS
// ===============================
app.use(
  cors({
    origin: true,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Tenant-Id",
      "X-Widget-Key",
      "X-Webchat-Token"
    ],
    exposedHeaders: ["Authorization"]
  })
);

app.use(express.json({ limit: "5mb" }));

// ===============================
// HELPERS
// ===============================
function requirePrisma(_req, res, next) {
  if (prismaReady) return next();
  return res.status(503).json({ error: "db_not_ready" });
}

// ===============================
// TENANT RESOLUTION (ANTES DE AUTH)
// ===============================
const PUBLIC_NO_TENANT_PATHS = [
  "/",
  "/health",
  "/login",
  "/auth/login",
  "/auth/select-tenant",
  "/auth/password",
  "/auth/password/verify",
  "/auth/password/set",
  "/webhook/whatsapp",
  "/webchat"
];

app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: PUBLIC_NO_TENANT_PATHS
  })
);

// ===============================
// 🌍 ROTAS PÚBLICAS
// ===============================
app.get("/", (_req, res) => res.json({ status: "ok" }));

app.get("/health", async (_req, res) => {
  let users = 0;
  let tenants = 0;
  let whatsappEnabledTenants = 0;

  try {
    if (prismaReady) {
      users = await prisma.user.count();
      tenants = await prisma.tenant.count();
      whatsappEnabledTenants = await prisma.channelConfig.count({
        where: { channel: "whatsapp", enabled: true }
      });
    }
  } catch {}

  res.json({
    ok: true,
    env: ENV,
    prismaReady,
    users,
    tenants,
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    hasWhatsappDefaultTenant: !!process.env.WHATSAPP_DEFAULT_TENANT_ID,
    whatsappEnabledTenants,
    uptime: process.uptime()
  });
});

app.use("/", authRouter);
app.use("/auth", passwordRouter);

// 🌐 Widgets / Webhooks públicos
app.use("/webchat", requirePrisma, webchatRouter);
app.use("/webhook/whatsapp", requirePrisma, whatsappRouter);

// ===============================
// 🔒 MIDDLEWARE GLOBAL
// ===============================
app.use(requireAuth);
app.use(enforceTokenTenant);

app.use(
  requireTenant({
    allowNoTenantPaths: PUBLIC_NO_TENANT_PATHS
  })
);

app.use(requirePrisma);

// ===============================
// 🔒 ROTAS PROTEGIDAS
// ===============================
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

// Settings
app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

// Conversas
app.use("/conversations", conversationsRouter);

// Outbound
app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);
app.use("/outbound/optout", optoutRouter);
app.use("/outbound/sms-campaigns", smsCampaignsRouter);
app.use("/outbound", outboundRouter);

// ===============================
// 404
// ===============================
app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, _next) => {
  logger.error(
    {
      err,
      url: req.url,
      method: req.method,
      tenantId: req.tenant?.id || req.tenantId || null,
      userId: req.user?.id || null
    },
    "❌ Erro não tratado"
  );

  res.status(500).json({ error: "internal_server_error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT, ENV, prismaReady }, "🚀 API rodando");
});
