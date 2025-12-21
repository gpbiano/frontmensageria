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
// DB utils — legado/compat (health)
// ===============================
import { loadDB } from "./utils/db.js";

// ===============================
// PATHS + ENV LOAD
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

// Carrega env de forma robusta (prod -> .env.production, senão .env)
const envProdPath = path.join(__dirname, "..", ".env.production");
const envDevPath = path.join(__dirname, "..", ".env");

if (ENV === "production" && fs.existsSync(envProdPath)) {
  dotenv.config({ path: envProdPath });
} else if (fs.existsSync(envDevPath)) {
  dotenv.config({ path: envDevPath });
} else if (fs.existsSync(envProdPath)) {
  // fallback (às vezes o servidor está em prod mas NODE_ENV não veio)
  dotenv.config({ path: envProdPath });
}

// Compat WhatsApp ENV
if (!process.env.PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER_ID) {
  process.env.PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
}
if (!process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.PHONE_NUMBER_ID) {
  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
}

// Base domain (resolução por domínio/origin)
process.env.TENANT_BASE_DOMAIN ||= "cliente.gplabs.com.br";

// ===============================
// Logger (depois do dotenv)
// ===============================
const { default: logger } = await import("./logger.js");

// ===============================
// Prisma (depois do dotenv)
// ===============================
let prisma;
let prismaReady = false;

try {
  const mod = await import("./lib/prisma.js");

  // Aceita tanto export default quanto export nomeado (compat)
  prisma = mod?.default || mod?.prisma;

  const hasUser = !!prisma?.user;
  const hasTenant = !!prisma?.tenant;

  // Prisma "ready" só quando os models esperados existem
  prismaReady = !!(hasUser && hasTenant);

  if (!prismaReady) {
    // ⚠️ NÃO é erro fatal no core atual (ainda usamos data.json)
    // Mantemos API rodando e retornamos 503 apenas nas rotas que dependem do DB (requirePrisma)
    logger.warn(
      {
        prismaReady,
        hasUser,
        hasTenant,
        exportedKeys: prisma ? Object.keys(prisma) : [],
      },
      "⚠️ Prisma Client carregou, mas models esperados não existem (user/tenant). Mantendo API no modo data.json. (Isso é OK até migrarmos o core para Postgres.)"
    );
  } else {
    logger.info(
      { prismaReady, hasUser, hasTenant },
      "✅ Prisma pronto (models user/tenant encontrados)."
    );
  }
} catch (err) {
  prismaReady = false;
  // ⚠️ Também não é fatal por enquanto: só indica que DB relacional ainda não está ativo
  logger.warn({ err }, "⚠️ Prisma não disponível (./lib/prisma.js). Mantendo API no modo data.json.");
}

// ===============================
// Routers
// ===============================
const { default: webchatRouter } = await import("./routes/webchat.js");
const { default: channelsRouter } = await import("./routes/channels.js");
const { default: conversationsRouter } = await import("./routes/conversations.js");

const { default: chatbotRouter } = await import("./chatbot/chatbotRouter.js");
const { default: humanRouter } = await import("./human/humanRouter.js");
const { default: assignmentRouter } = await import("./human/assignmentRouter.js");

const { default: usersRouter } = await import("./settings/usersRouter.js");
const { default: groupsRouter } = await import("./settings/groupsRouter.js");

const { default: passwordRouter } = await import("./auth/passwordRouter.js");
const { verifyPassword } = await import("./security/passwords.js");

const { default: outboundRouter } = await import("./outbound/outboundRouter.js");
const { default: numbersRouter } = await import("./outbound/numbersRouter.js");
const { default: templatesRouter } = await import("./outbound/templatesRouter.js");
const { default: assetsRouter } = await import("./outbound/assetsRouter.js");
const { default: campaignsRouter } = await import("./outbound/campaignsRouter.js");
const { default: optoutRouter } = await import("./outbound/optoutRouter.js");
const { default: smsCampaignsRouter } = await import("./outbound/smsCampaignsRouter.js");

const { default: whatsappRouter } = await import("./routes/channels/whatsappRouter.js");

// ===============================
// VARS
// ===============================
const PORT = process.env.PORT || 3010;

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET não definido");
}

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ===============================
// UPLOADS (opcional)
// ===============================
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

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
      ignore: (req) => req.method === "OPTIONS" || req.url.startsWith("/health"),
    },
  })
);

// ===============================
// CORS (explícito e seguro)
// ===============================
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

const PLATFORM_ALLOWED_ORIGINS = new Set(
  [
    "https://cliente.gplabs.com.br",
    "https://gplabs.com.br",
    "https://www.gplabs.com.br",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].map(normalizeOrigin)
);

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // curl / server-to-server
    const o = normalizeOrigin(origin);
    if (PLATFORM_ALLOWED_ORIGINS.has(o)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Tenant-Id"],
  exposedHeaders: ["X-Request-Id"],
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ===============================
// PARSERS + STATIC
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// RESOLVE CONTEXTO (tenant)
// IMPORTANT: depois do CORS pra não quebrar preflight
// ===============================
app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: ["/", "/health", "/login", "/auth/select-tenant", "/webhook/whatsapp"],
  })
);

// ===============================
// HELPERS
// ===============================
function isSuperAdmin(user) {
  return user?.role === "super_admin" || user?.scope === "global";
}

// Se Prisma não estiver OK, não deixa “cair”: devolve 503 nas rotas que dependem do DB
function requirePrisma(req, res, next) {
  if (prismaReady) return next();
  return res.status(503).json({
    error: "DB not ready",
    code: "DB_NOT_READY",
  });
}

// Hidrata contexto da organização a partir do token quando não houver subdomínio
async function attachOrgFromToken(req, res, next) {
  try {
    if (req.tenant?.id) return next();

    const orgId = req.user?.tenantId || req.user?.organizationId || null;
    if (!orgId) return next();

    if (!prismaReady) return next(); // sem prisma, não dá pra hidratar

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!org || !org.isActive) return next();

    req.tenant = { id: org.id, slug: org.slug, name: org.name, isActive: org.isActive };
    req.organization = { id: org.id, slug: org.slug, name: org.name };
    return next();
  } catch (e) {
    return next(e);
  }
}

// ===============================
// LOGIN (PÚBLICO)
// ===============================
app.post("/login", requirePrisma, async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      include: {
        tenants: {
          select: {
            role: true,
            tenant: { select: { id: true, slug: true, name: true, isActive: true } },
          },
        },
      },
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    const organizations = (user.tenants || [])
      .map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
        isActive: m.tenant.isActive,
        role: m.role,
      }))
      .filter((o) => o.isActive);

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        scope: isSuperAdmin(user) ? "global" : "user",
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const { passwordHash, ...safeUser } = user;
    return res.json({ token, user: safeUser, organizations });
  } catch (e) {
    return next(e);
  }
});

// ===============================
// SELECT ORGANIZATION (pós-login)
// ===============================
app.post("/auth/select-tenant", requireAuth, requirePrisma, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};
    const orgId = String(organizationId || "").trim();
    if (!orgId) {
      return res.status(400).json({ error: "Informe a organização." });
    }

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!org || !org.isActive) {
      return res.status(404).json({ error: "Organização inválida." });
    }

    let effectiveRole = req.user?.role || "agent";

    if (!isSuperAdmin(req.user)) {
      const membership = await prisma.userTenant.findFirst({
        where: { userId: req.user.id, tenantId: org.id, isActive: true },
        select: { role: true },
      });

      if (!membership) {
        return res.status(403).json({ error: "Acesso negado." });
      }

      effectiveRole = membership.role || effectiveRole;
    }

    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        role: effectiveRole,
        scope: isSuperAdmin(req.user) ? "global" : "user",
        tenantId: org.id,
        organizationId: org.id,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      organization: { id: org.id, slug: org.slug, name: org.name },
    });
  } catch (e) {
    return next(e);
  }
});

// ===============================
// ROTAS PROTEGIDAS (organização obrigatória)
// Ordem:
// 1) requireAuth
// 2) attachOrgFromToken
// 3) enforceTokenTenant
// 4) requireTenant
// 5) requirePrisma (garante DB pronto antes de entrar nos routers)
// ===============================
app.use(
  ["/api", "/settings", "/conversations", "/outbound", "/auth"],
  requireAuth,
  attachOrgFromToken,
  enforceTokenTenant,
  requireTenant,
  requirePrisma
);

// ===============================
// ROTAS
// ===============================

// API (chatbot / humano)
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

// Settings
app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

// Auth (painel)
app.use("/auth", passwordRouter);

// WebChat (público/widget)
app.use("/webchat", webchatRouter);

// Conversas
app.use("/conversations", conversationsRouter);

// WhatsApp webhook (público)
app.use("/webhook/whatsapp", whatsappRouter);

// Outbound
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
app.get("/", (req, res) => res.json({ status: "ok" }));

app.get("/health", (req, res) => {
  const db = loadDB();
  res.json({
    ok: true,
    env: ENV,
    prismaReady,
    conversations: db?.conversations?.length || 0,
    users: db?.users?.length || 0,
    uptime: process.uptime(),
  });
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err, url: req?.url, method: req?.method }, "Erro não tratado");

  const msg = String(err?.message || "");

  if (msg.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "CORS blocked." });
  }

  // Em dev, ajuda muito a debugar sem abrir dados em prod
  if (ENV !== "production") {
    return res.status(500).json({ error: "Internal server error", message: msg });
  }

  return res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT, ENV, prismaReady }, "🚀 API rodando");
});
