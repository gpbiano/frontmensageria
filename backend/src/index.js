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
// ENV
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";

dotenv.config({
  path: path.join(__dirname, "..", ENV === "production" ? ".env.production" : ".env")
});

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
// Prisma (robusto)
// - evita prisma undefined por diferença de export no ./lib/prisma.js
// ===============================
const prismaModule = await import("./lib/prisma.js");

// tenta achar o PrismaClient exportado de várias formas comuns
const prisma =
  prismaModule.prisma ||
  prismaModule.default ||
  prismaModule.client ||
  prismaModule.db ||
  null;

if (!prisma) {
  logger.fatal(
    { exportedKeys: Object.keys(prismaModule || {}) },
    "❌ Prisma não encontrado em ./lib/prisma.js"
  );
  throw new Error("Prisma não encontrado em ./lib/prisma.js");
}

// valida que tem pelo menos um model (user) antes de seguir
if (!prisma.user || typeof prisma.user.findFirst !== "function") {
  logger.fatal(
    { hasUser: !!prisma.user, exportedKeys: Object.keys(prismaModule || {}) },
    "❌ PrismaClient inválido (prisma.user não existe). Verifique exports do ./lib/prisma.js"
  );
  throw new Error("PrismaClient inválido: prisma.user não existe");
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
if (!JWT_SECRET) throw new Error("JWT_SECRET não definido");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// ===============================
// UPLOADS
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
      ignore: (req) =>
        req.method === "OPTIONS" ||
        req.url.startsWith("/health") ||
        req.url.startsWith("/uploads/")
    }
  })
);

// ===============================
// PARSERS + STATIC
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// CORS (ANTES do resolveTenant)
// ===============================
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function isAllowedOrigin(origin) {
  const o = normalizeOrigin(origin);
  if (!o) return true;

  const allow = new Set([
    "https://cliente.gplabs.com.br",
    "https://gplabs.com.br",
    "https://www.gplabs.com.br",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ]);

  if (allow.has(o)) return true;

  // permite subdomínios *.gplabs.com.br (opcional)
  try {
    const u = new URL(o);
    if (u.hostname.endsWith(".gplabs.com.br")) return true;
  } catch {}

  return false;
}

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (isAllowedOrigin(origin)) return cb(null, true);
    return cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "X-Tenant-Id",
    "X-Request-Id"
  ],
  exposedHeaders: ["X-Request-Id"]
};

app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// ===============================
// RESOLVE CONTEXTO (por domínio/origin/header)
// ===============================
app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: ["/", "/health", "/login", "/auth/select-tenant", "/webhook/whatsapp"]
  })
);

// ===============================
// HELPERS
// ===============================
function isSuperAdmin(user) {
  return user?.role === "super_admin" || user?.scope === "global";
}

// Hidrata contexto a partir do token quando não houver subdomínio
async function attachOrgFromToken(req, res, next) {
  try {
    if (req.tenant?.id) return next();

    const orgId = req.user?.tenantId || req.user?.organizationId || null;
    if (!orgId) return next();

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true }
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
app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    const user = await prisma.user.findFirst({
      where: { email, isActive: true }
    });

    if (!user || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    // memberships
    const memberships = await prisma.userTenant.findMany({
      where: { userId: user.id, isActive: true },
      select: {
        role: true,
        tenant: { select: { id: true, slug: true, name: true, isActive: true } }
      }
    });

    const organizations = (memberships || [])
      .map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        name: m.tenant.name,
        isActive: m.tenant.isActive,
        role: m.role
      }))
      .filter((o) => o.isActive);

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        scope: isSuperAdmin(user) ? "global" : "user"
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    const { passwordHash, ...safeUser } = user;
    return res.json({ token, user: safeUser, organizations });
  } catch (e) {
    logger.error({ err: e }, "❌ Erro no /login");
    return next(e);
  }
});

// ===============================
// SELECT ORGANIZATION (pós-login)
// ===============================
app.post("/auth/select-tenant", requireAuth, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};
    const orgId = String(organizationId || "").trim();
    if (!orgId) return res.status(400).json({ error: "Informe a organização." });

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true }
    });

    if (!org || !org.isActive) {
      return res.status(404).json({ error: "Organização inválida." });
    }

    let effectiveRole = req.user?.role || "agent";

    if (!isSuperAdmin(req.user)) {
      const membership = await prisma.userTenant.findFirst({
        where: { userId: req.user.id, tenantId: org.id, isActive: true },
        select: { role: true }
      });

      if (!membership) return res.status(403).json({ error: "Acesso negado." });

      effectiveRole = membership.role || effectiveRole;
    }

    const token = jwt.sign(
      {
        id: req.user.id,
        email: req.user.email,
        role: effectiveRole,
        scope: isSuperAdmin(req.user) ? "global" : "user",
        tenantId: org.id,
        organizationId: org.id
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    return res.json({
      token,
      organization: { id: org.id, slug: org.slug, name: org.name }
    });
  } catch (e) {
    logger.error({ err: e }, "❌ Erro no /auth/select-tenant");
    return next(e);
  }
});

// ===============================
// ROTAS PROTEGIDAS
// ===============================
app.use(
  ["/api", "/settings", "/conversations", "/outbound", "/auth"],
  requireAuth,
  attachOrgFromToken,
  enforceTokenTenant,
  requireTenant
);

// API
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

// Settings
app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

// Auth
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
    conversations: db?.conversations?.length || 0,
    users: db?.users?.length || 0,
    uptime: process.uptime()
  });
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err }, "Erro não tratado");
  const msg = String(err?.message || "");

  if (msg.startsWith("CORS blocked")) {
    return res.status(403).json({ error: "CORS blocked." });
  }

  return res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT, ENV }, "🚀 API rodando");
});
