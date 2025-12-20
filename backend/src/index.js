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

// ===============================
// DB utils — FONTE ÚNICA (legado / compat)
// ===============================
import { loadDB, saveDB, ensureArray } from "./utils/db.js";

// ===============================
// ENV (dotenv ANTES de qualquer router/middleware que use process.env)
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

const dotenvResult = dotenv.config({
  path: path.join(__dirname, "..", ENV === "production" ? ".env.production" : ".env")
});

if (dotenvResult.error) {
  console.error("❌ Falha ao carregar dotenv:", dotenvResult.error);
}

// ✅ Compat WhatsApp ENV (evita 500 em routers antigos)
if (!process.env.PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER_ID) {
  process.env.PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
}
if (!process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.PHONE_NUMBER_ID) {
  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
}
if (!process.env.WHATSAPP_VERIFY_TOKEN && process.env.VERIFY_TOKEN) {
  process.env.WHATSAPP_VERIFY_TOKEN = process.env.VERIFY_TOKEN;
}

// ✅ Multi-tenant base domain (FRONT)
if (!process.env.TENANT_BASE_DOMAIN) {
  process.env.TENANT_BASE_DOMAIN = "cliente.gplabs.com.br";
}

// ===============================
// Logger (depois do dotenv)
// ===============================
const { default: logger } = await import("./logger.js");

// ===============================
// Multi-tenant middlewares + prisma (DINÂMICO — depois do dotenv)
// ===============================
const { prisma } = await import("./lib/prisma.js");
const { resolveTenant } = await import("./middlewares/resolveTenant.js");
const { requireTenant } = await import("./middlewares/requireTenant.js");
const { requireAuth, enforceTokenTenant } = await import("./middlewares/requireAuth.js");

// ===============================
// Routers (TODOS dinâmicos — depois do dotenv)
// ===============================
const { default: webchatRouter } = await import("./routes/webchat.js");
const { default: channelsRouter } = await import("./routes/channels.js");
const { default: conversationsRouter } = await import("./routes/conversations.js");
const { default: smsCampaignsRouter } = await import("./outbound/smsCampaignsRouter.js");

// Dinâmicos já existentes
const { default: chatbotRouter } = await import("./chatbot/chatbotRouter.js");
const { default: humanRouter } = await import("./human/humanRouter.js");
const { default: assignmentRouter } = await import("./human/assignmentRouter.js");

// Settings
const { default: usersRouter } = await import("./settings/usersRouter.js");
const { default: groupsRouter } = await import("./settings/groupsRouter.js");

// Auth
const { default: passwordRouter } = await import("./auth/passwordRouter.js");
const { verifyPassword } = await import("./security/passwords.js");

// Outbound
const { default: outboundRouter } = await import("./outbound/outboundRouter.js");
const { default: numbersRouter } = await import("./outbound/numbersRouter.js");
const { default: templatesRouter } = await import("./outbound/templatesRouter.js");
const { default: assetsRouter } = await import("./outbound/assetsRouter.js");
const { default: campaignsRouter } = await import("./outbound/campaignsRouter.js");
const { default: optoutRouter } = await import("./outbound/optoutRouter.js");

// WhatsApp (CANAL ISOLADO)
const { default: whatsappRouter } = await import("./routes/channels/whatsappRouter.js");

// ===============================
// VARS
// ===============================
const PORT = process.env.PORT || 3010;

// ✅ JWT_SECRET obrigatório (NUNCA fallback)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || !String(JWT_SECRET).trim()) {
  logger.fatal("❌ JWT_SECRET não definido. Configure no .env.production.");
  throw new Error("JWT_SECRET não definido.");
}

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;

const EFFECTIVE_PHONE_NUMBER_ID =
  String(WHATSAPP_PHONE_NUMBER_ID || PHONE_NUMBER_ID || "").trim() || null;

logger.info(
  {
    ENV,
    PORT,
    WABA_ID,
    WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_PHONE_NUMBER_ID || null,
    PHONE_NUMBER_ID: PHONE_NUMBER_ID || null,
    EFFECTIVE_PHONE_NUMBER_ID,
    WHATSAPP_TOKEN_defined: !!WHATSAPP_TOKEN,
    JWT_SECRET_len: String(JWT_SECRET).length,
    TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN
  },
  "✅ Ambiente carregado"
);

// ===============================
// HANDLERS NODE
// ===============================
process.on("unhandledRejection", (r) => logger.error({ r }, "UnhandledRejection"));
process.on("uncaughtException", (e) => {
  logger.fatal({ e }, "UncaughtException");
  process.exit(1);
});

// ===============================
// UPLOADS (path fixo)
// ===============================
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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
    autoLogging: {
      ignore: (req) =>
        req.method === "OPTIONS" ||
        req.url.startsWith("/health") ||
        req.url.startsWith("/uploads/")
    }
  })
);

// ===============================
// RESOLVE TENANT (antes do CORS)
// - API fixa: resolve tenant pelo Origin/Referer (FRONT) ou X-Tenant-Id (fallback)
// ===============================
app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN || "cliente.gplabs.com.br",
    // ✅ inclui /login para não bloquear fluxos (especialmente local/dev)
    allowNoTenantPaths: ["/", "/health", "/login", "/webhook/whatsapp"]
  })
);

// ===============================
// CORS (dinâmico por tenant + widget headers)
// ===============================
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// Origens "fixas" da plataforma (master/admin/dev)
const PLATFORM_ALLOWED_ORIGINS = [
  "https://cliente.gplabs.com.br",
  "https://gplabs.com.br",
  "https://www.gplabs.com.br",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
].map(normalizeOrigin);

// Busca allowedOrigins do WebChat por tenant (Postgres)
// ✅ fallback compat: se ainda não tiver ChannelConfig, usa JSON antigo sem quebrar
async function getWebchatAllowedOriginsFromDB(tenantId) {
  if (!tenantId) return [];

  try {
    const row = await prisma.channelConfig.findFirst({
      where: { tenantId, type: "webchat" },
      select: { allowedOrigins: true }
    });

    const allowed = row?.allowedOrigins || [];
    return Array.isArray(allowed) ? allowed.map(normalizeOrigin).filter(Boolean) : [];
  } catch (e) {
    // Compat / transição: mantém o comportamento antigo (single-tenant JSON)
    try {
      const db = loadDB();
      const allowed =
        db?.settings?.channels?.webchat?.allowedOrigins ||
        db?.channels?.webchat?.allowedOrigins ||
        [];
      return Array.isArray(allowed) ? allowed.map(normalizeOrigin).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
}

// Middleware CORS por request (permite usar req.path)
async function corsPerRequest(req, res, next) {
  const isWebchat = String(req.path || "").startsWith("/webchat");
  const tenantId = req.tenant?.id || null;

  const dynamicWebchatOrigins = isWebchat ? await getWebchatAllowedOriginsFromDB(tenantId) : [];

  const origin = normalizeOrigin(req.headers.origin || "");
  const allowOriginBecauseTenantResolved =
    !!origin &&
    !!req.tenant?.id &&
    origin.includes(`.${process.env.TENANT_BASE_DOMAIN}`);

  const allowedList = [
    ...PLATFORM_ALLOWED_ORIGINS,
    ...dynamicWebchatOrigins,
    ...(allowOriginBecauseTenantResolved ? [origin] : [])
  ]
    .map(normalizeOrigin)
    .filter(Boolean);

  const corsOptions = {
    origin(requestOrigin, cb) {
      if (!requestOrigin) return cb(null, true);

      const o = normalizeOrigin(requestOrigin);
      if (allowedList.includes(o)) return cb(null, true);

      return cb(new Error(`CORS blocked: ${requestOrigin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Widget-Key",
      "X-Webchat-Token",
      "X-Tenant-Id"
    ],
    exposedHeaders: ["X-Request-Id"]
  };

  return cors(corsOptions)(req, res, next);
}

// ✅ FIX: wrapper pro async CORS (evita bug em OPTIONS)
const corsPerRequestHandler = (req, res, next) => {
  Promise.resolve(corsPerRequest(req, res, next)).catch(next);
};

app.use(corsPerRequestHandler);
app.options("*", corsPerRequestHandler);

// ===============================
// PARSERS
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// PROTEÇÃO DO PAINEL (multi-tenant)
// - exige JWT
// - trava tenant do token vs tenant resolvido
// - exige tenant resolvido
// ===============================
app.use(
  ["/api", "/settings", "/conversations", "/outbound", "/auth"],
  requireAuth,
  enforceTokenTenant,
  requireTenant
);

// ===============================
// ROTAS
// ===============================

// Chatbot / Human
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

// Settings
app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);

// Auth (painel)
app.use("/auth", passwordRouter);

// WebChat (público/widget)
app.use("/webchat", webchatRouter);

// Settings/channels faz parte do painel (já protegido)
app.use("/settings/channels", channelsRouter);

// Conversas (painel)
app.use("/conversations", conversationsRouter);

// WhatsApp Webhook (público)
app.use("/webhook/whatsapp", whatsappRouter);

// ===============================
// OUTBOUND (painel)
// ===============================
app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);
app.use("/outbound/optout", optoutRouter);
app.use("/outbound/sms-campaigns", smsCampaignsRouter);
app.use("/outbound", outboundRouter);

// ===============================
// HEALTH
// ===============================
app.get("/", (req, res) =>
  res.json({
    status: "ok",
    version: "2.0.0",
    wabaId: WABA_ID || null,
    phoneNumberId: EFFECTIVE_PHONE_NUMBER_ID
  })
);

app.get("/health", (req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    conversations: (db.conversations || []).length,
    users: (db.users || []).length,
    uptime: process.uptime()
  });
});

// ===============================
// LOGIN (multi-tenant definitivo - API fixa)
// ===============================
app.post("/login", async (req, res, next) => {
  try {
    const { email, password, tenantSlug } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const slug = String(req.tenantSlug || tenantSlug || "").trim() || null;
    if (!slug) {
      return res.status(400).json({ error: "Informe a empresa (tenant)." });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, isActive: true }
    });

    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ error: "Tenant inválido." });
    }

    const user = await prisma.user.findFirst({
      where: { tenantId: tenant.id, email, isActive: true }
    });

    if (!user) {
      return res.status(401).json({ error: "Usuário inválido." });
    }

    const okPrisma = user.passwordHash && verifyPassword(password, user.passwordHash);
    if (!okPrisma) {
      return res.status(401).json({ error: "Senha incorreta." });
    }

    const token = jwt.sign(
      {
        id: user.id,
        tenantId: tenant.id,
        role: user.role,
        name: user.name,
        email: user.email
      },
      JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
    );

    const { passwordHash: _ph, ...safeUser } = user;
    res.json({ token, user: safeUser, tenant: { id: tenant.id, slug: tenant.slug } });
  } catch (e) {
    return next(e);
  }
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err }, "Erro não tratado");
  if (err.message?.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "CORS blocked." });
  }
  res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT }, "🚀 API rodando");
});
