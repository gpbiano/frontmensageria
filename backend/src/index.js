// backend/src/index.js
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
// PATHS + ENV LOAD
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

const envProdPath = path.join(__dirname, "..", ".env.production");
const envDevPath = path.join(__dirname, "..", ".env");

if (ENV === "production" && fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath, override: true });
} else if (fs.existsSync(envDevPath)) {
  dotenv.config({ path: envDevPath, override: false });
} else if (fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath, override: false });
}

process.env.TENANT_BASE_DOMAIN ||= "cliente.gplabs.com.br";

// ===============================
// LOGGER
// ===============================
const { default: logger } = await import("./logger.js");

logger.info(
  { ENV, TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN },
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
  prismaReady = !!(prisma?.user && prisma?.tenant && prisma?.conversation && prisma?.message);
  logger.info({ prismaReady }, "🧠 Prisma status");
} catch (err) {
  prismaReady = false;
  logger.error({ err }, "❌ Erro ao carregar Prisma");
}

// ===============================
// ROUTERS
// ===============================
const { default: authRouter } = await import("./auth/authRouter.js");
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
const { default: messengerRouter } = await import("./routes/channels/messengerRouter.js");
const { default: instagramWebhookRouter } = await import("./routes/webhooks/instagramWebhookRouter.js");

// ✅ NEW: Reports (Analytics unificado)
const { default: reportsRouter } = await import("./routes/reports.js");

// ===============================
// APP
// ===============================
const app = express();
app.set("etag", false);
app.disable("x-powered-by");
app.set("trust proxy", 1);

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
        req.url.startsWith("/webhook/")
    }
  })
);

// ===============================
// CORS
// ===============================
function buildAllowedOrigins() {
  const raw = String(process.env.CORS_ORIGINS || "").trim();
  const defaults = [
    "https://cliente.gplabs.com.br",
    "https://app.gplabs.com.br",
    "https://gplabs.com.br",
    "https://www.gplabs.com.br",
    "http://localhost:5173",
    "http://localhost:3000"
  ];
  if (!raw) return defaults;
  const extra = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return Array.from(new Set([...defaults, ...extra]));
}

const ALLOWED_ORIGINS = buildAllowedOrigins();

const corsConfig = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (ENV !== "production") return cb(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Tenant-Id",
    "X-Tenant-Slug",
    "X-Widget-Key",
    "X-Webchat-Token"
  ],
  exposedHeaders: ["Authorization"],
  maxAge: 86400
};

app.use(cors(corsConfig));
app.options("*", cors(corsConfig));

// ===============================
// HELPERS
// ===============================
function requirePrisma(_req, res, next) {
  if (prismaReady) return next();
  return res.status(503).json({ error: "db_not_ready" });
}

async function webchatTenantFallback(req, res, next) {
  try {
    if (req.tenant?.id) return next();

    const headerTenantId = req.headers["x-tenant-id"];
    const headerTenantSlug = req.headers["x-tenant-slug"];

    const tenantId = String(req.query.tenantId || headerTenantId || "").trim();
    const tenantSlug = String(req.query.tenant || headerTenantSlug || "").trim();

    let t = null;
    if (tenantId) t = await prisma.tenant.findUnique({ where: { id: tenantId } });
    else if (tenantSlug) t = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });

    if (t?.isActive) {
      req.tenant = t;
      req.tenantId = t.id;
      return next();
    }

    return res.status(400).json({ error: "missing_tenant_context" });
  } catch (err) {
    logger.error({ err }, "❌ webchatTenantFallback failed");
    return res.status(500).json({ error: "internal_server_error" });
  }
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
  "/webhook/messenger",
  "/webhook/instagram",
  "/webchat",
  "/br/webchat"
];

app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: PUBLIC_NO_TENANT_PATHS
  })
);

// ===============================
// ✅ BODY PARSERS (CRÍTICO)
// - Precisam vir ANTES do /login (authRouter)
// - Mas NÃO podem “tocar” o Instagram webhook (usa RAW)
// ===============================
const jsonParser = express.json({
  limit: "5mb",
  type: ["application/json", "application/*+json"],
  verify: (req, _res, buf) => {
    // útil p/ assinatura (WA) e debug
    req.rawBody = buf;
  }
});

const urlParser = express.urlencoded({ extended: true });

// pula parsers no Instagram (porque ele usa RAW 1:1 com assinatura)
function skipInstagram(req) {
  return req.originalUrl?.startsWith("/webhook/instagram");
}

app.use((req, res, next) => {
  if (skipInstagram(req)) return next();
  return jsonParser(req, res, next);
});

app.use((req, res, next) => {
  if (skipInstagram(req)) return next();
  return urlParser(req, res, next);
});

// ===============================
// 🌍 ROTAS PÚBLICAS
// ===============================
app.get("/", (_req, res) => res.json({ status: "ok" }));

app.get("/health", async (_req, res) => {
  let users = 0;
  let tenants = 0;

  if (prismaReady) {
    try {
      users = await prisma.user.count();
      tenants = await prisma.tenant.count();
    } catch {}
  }

  res.json({
    ok: true,
    env: ENV,
    prismaReady,
    users,
    tenants,
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    uptime: process.uptime()
  });
});

// ✅ Auth (precisa do JSON parser já ativo)
app.use("/", authRouter);
app.use("/auth", passwordRouter);

// ✅ Webchat público
app.use("/webchat", requirePrisma, webchatTenantFallback, webchatRouter);
app.use("/br/webchat", requirePrisma, webchatTenantFallback, webchatRouter);

// ===============================
// ✅ WEBHOOKS PÚBLICOS
// ===============================

// Whats/Messenger usam JSON normal (já parseado acima)
app.use("/webhook/whatsapp", whatsappRouter);
app.use("/webhook/messenger", messengerRouter);

// ✅ CRÍTICO: Instagram com RAW (sem JSON antes)
app.use(
  "/webhook/instagram",
  express.raw({
    type: "*/*",
    limit: "5mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf; // Buffer exato
    }
  }),
  instagramWebhookRouter
);

// ===============================
// 🔒 MIDDLEWARE GLOBAL (PROTEGIDO)
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

app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

app.use("/conversations", conversationsRouter);

// ✅ Reports (Analytics unificado)
app.use("/reports", reportsRouter);

app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);
app.use("/outbound/optout", optoutRouter);
app.use("/outbound/sms-campaigns", smsCampaignsRouter);
app.use("/outbound", outboundRouter);

// 404
app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

// Error handler
app.use((err, req, res, _next) => {
  logger.error(
    {
      err,
      url: req.url,
      method: req.method,
      origin: req.headers?.origin || null,
      tenantId: req.tenant?.id || null,
      userId: req.user?.id || null
    },
    "❌ Erro não tratado"
  );

  if (res.headersSent) return;

  const msg = err?.message ? String(err.message) : "internal_server_error";
  const isCors = msg.toLowerCase().includes("cors blocked");

  res.status(isCors ? 403 : 500).json({
    error: isCors ? "cors_blocked" : "internal_server_error",
    detail: ENV !== "production" ? msg : undefined
  });
});

// Start
const PORT = Number(process.env.PORT || 3010);
app.listen(PORT, () => {
  logger.info(
    {
      PORT,
      ENV,
      prismaReady,
      allowedOrigins: ENV === "production" ? ALLOWED_ORIGINS : "dev:allow-all"
    },
    "🚀 API rodando"
  );
});
