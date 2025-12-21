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
  path: path.join(__dirname, "..", ENV === "production" ? ".env.production" : ".env"),
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
// Prisma (depois do dotenv)
// - NÃO derruba o servidor se o Prisma estiver inválido/sem models.
// ===============================
let prisma = null;
try {
  const mod = await import("./lib/prisma.js");
  prisma = mod?.prisma || null;
} catch (e) {
  prisma = null;
  logger.error({ err: e }, "❌ Falha ao importar ./lib/prisma.js (Prisma indisponível)");
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
  // Se isso acontecer em produção, normalmente é porque o PM2 não está startando com NODE_ENV=production
  // ou porque o arquivo .env.production não está sendo lido.
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
// - resolve preflight (OPTIONS) corretamente
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
// RESOLVE CONTEXTO (por domínio/origin/header)
// - Mantém "tenant" somente no backend, sem expor no front.
// - Libera rotas públicas que não exigem contexto.
// IMPORTANTE: fica DEPOIS do CORS pra não quebrar preflight.
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

function prismaReady() {
  // Prisma válido precisa ter os delegates (user/tenant/userTenant etc).
  return !!(prisma && prisma.user && prisma.tenant);
}

// Hidrata contexto da organização a partir do token quando não houver subdomínio
async function attachOrgFromToken(req, res, next) {
  try {
    if (req.tenant?.id) return next();

    const orgId = req.user?.tenantId || req.user?.organizationId || null;
    if (!orgId) return next();

    // Se prisma não está pronto, não dá pra hidratar por Postgres
    if (!prismaReady()) return next();

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
// - Não pede "empresa" no front.
// - Retorna lista de organizações vinculadas (quando Prisma estiver pronto).
// - Se Prisma NÃO estiver pronto, retorna 503 claro.
// ===============================
app.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    if (!prismaReady()) {
      logger.error(
        { exportedKeys: prisma ? Object.keys(prisma) : [], hasUser: !!prisma?.user, hasTenant: !!prisma?.tenant },
        "❌ PrismaClient inválido (prisma.user/prisma.tenant não existem). Schema sem models."
      );
      return res.status(503).json({ error: "Banco (Prisma) ainda não está pronto. Gere o client e/ou ajuste o schema." });
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

    // remove passwordHash do retorno
    const { passwordHash, ...safeUser } = user;
    return res.json({ token, user: safeUser, organizations });
  } catch (e) {
    return next(e);
  }
});

// ===============================
// SELECT ORGANIZATION (pós-login)
// - Front manda organizationId (sem "tenant").
// - Super admin pode selecionar qualquer.
// - Usuário normal só seleciona as vinculadas.
// - Retorna NOVO token com organização travada.
// ===============================
app.post("/auth/select-tenant", requireAuth, async (req, res, next) => {
  try {
    const { organizationId } = req.body || {};
    const orgId = String(organizationId || "").trim();
    if (!orgId) return res.status(400).json({ error: "Informe a organização." });

    if (!prismaReady()) {
      return res.status(503).json({ error: "Banco (Prisma) ainda não está pronto para seleção de organização." });
    }

    const org = await prisma.tenant.findUnique({
      where: { id: orgId },
      select: { id: true, slug: true, name: true, isActive: true },
    });

    if (!org || !org.isActive) {
      return res.status(404).json({ error: "Organização inválida." });
    }

    let effectiveRole = req.user?.role || "agent";

    // Se não for super admin, precisa membership ativa
    if (!isSuperAdmin(req.user)) {
      const membership = await prisma.userTenant.findFirst({
        where: { userId: req.user.id, tenantId: org.id, isActive: true },
        select: { role: true },
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
        tenantId: org.id, // compat interno
        organizationId: org.id, // nome que o front usa
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
// ===============================
app.use(
  ["/api", "/settings", "/conversations", "/outbound", "/auth"],
  requireAuth,
  attachOrgFromToken,
  enforceTokenTenant,
  requireTenant
);

// ===============================
// ROTAS
// ===============================
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
    uptime: process.uptime(),
    prismaReady: prismaReady(),
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
  logger.info({ PORT, ENV, prismaReady: prismaReady() }, "🚀 API rodando");
});
