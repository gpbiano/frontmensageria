// backend/src/index.js

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

import { loadDB } from "./utils/db.js";

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

const { default: logger } = await import("./logger.js");
const { prisma } = await import("./lib/prisma.js");

// Routers
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

// Vars
const PORT = process.env.PORT || 3010;

const JWT_SECRET = String(process.env.JWT_SECRET || "").trim();
if (!JWT_SECRET) throw new Error("JWT_SECRET não definido");

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

// Uploads
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// App
const app = express();
app.set("etag", false);

// Logger HTTP
app.use(
  pinoHttp({
    logger,
    quietReqLogger: true,
    autoLogging: {
      ignore: (req) => req.method === "OPTIONS" || req.url.startsWith("/health")
    }
  })
);

// Helpers CORS
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

const BASE = String(process.env.TENANT_BASE_DOMAIN || "").trim();

const PLATFORM_ALLOWED_ORIGINS = new Set(
  [
    "https://cliente.gplabs.com.br",
    "https://gplabs.com.br",
    "https://www.gplabs.com.br",
    "http://localhost:5173",
    "http://127.0.0.1:5173"
  ].map(normalizeOrigin)
);

function isOriginAllowed(origin) {
  const o = normalizeOrigin(origin);
  if (!o) return true; // server-to-server
  if (PLATFORM_ALLOWED_ORIGINS.has(o)) return true;
  if (BASE && o.endsWith(`.${BASE}`)) return true; // subdomínios
  return false;
}

// ✅ CORS “blindado”
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin && isOriginAllowed(origin)) {
    res.header("Access-Control-Allow-Origin", normalizeOrigin(origin));
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization, X-Requested-With, X-Tenant-Id"
    );
    res.header("Access-Control-Expose-Headers", "X-Request-Id");
  }

  // Preflight sempre retorna rápido
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

// Parsers + static
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// Resolve contexto (depois do CORS)
app.use(
  resolveTenant({
    tenantBaseDomain: process.env.TENANT_BASE_DOMAIN,
    allowNoTenantPaths: ["/", "/health", "/login", "/auth/select-tenant", "/webhook/whatsapp"]
  })
);

function isSuperAdmin(user) {
  return user?.role === "super_admin" || user?.scope === "global";
}

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

// Login
app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: "Informe e-mail e senha." });

    const user = await prisma.user.findFirst({
      where: { email, isActive: true },
      include: {
        tenants: {
          select: {
            role: true,
            tenant: { select: { id: true, slug: true, name: true, isActive: true } }
          }
        }
      }
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
    return next(e);
  }
});

// Select organization
app.post("/auth/select-tenant", requireAuth, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};
    const orgId = String(organizationId || "").trim();
    if (!orgId) return res.status(400).json({ error: "Informe a organização." });

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true }
    });

    if (!org || !org.isActive) return res.status(404).json({ error: "Organização inválida." });

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

    return res.json({ token, organization: { id: org.id, slug: org.slug, name: org.name } });
  } catch (e) {
    return next(e);
  }
});

// Protected routes
app.use(
  ["/api", "/settings", "/conversations", "/outbound", "/auth"],
  requireAuth,
  attachOrgFromToken,
  enforceTokenTenant,
  requireTenant
);

// Routes
app.use("/api", chatbotRouter);
app.use("/api/human", humanRouter);
app.use("/api/human", assignmentRouter);

app.use("/settings", usersRouter);
app.use("/settings/groups", groupsRouter);
app.use("/settings/channels", channelsRouter);

app.use("/auth", passwordRouter);

app.use("/webchat", webchatRouter);
app.use("/conversations", conversationsRouter);
app.use("/webhook/whatsapp", whatsappRouter);

app.use("/outbound/assets", assetsRouter);
app.use("/outbound/numbers", numbersRouter);
app.use("/outbound/templates", templatesRouter);
app.use("/outbound/campaigns", campaignsRouter);
app.use("/outbound/optout", optoutRouter);
app.use("/outbound/sms-campaigns", smsCampaignsRouter);
app.use("/outbound", outboundRouter);

// Health
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

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err }, "Erro não tratado");
  const msg = String(err?.message || "");

  if (msg.startsWith("CORS")) {
    return res.status(403).json({ error: "CORS blocked." });
  }

  return res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  logger.info({ PORT, ENV }, "🚀 API rodando");
});
