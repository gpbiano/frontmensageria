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
// DB utils — FONTE ÚNICA
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

// ===============================
// Logger (depois do dotenv)
// ===============================
const { default: logger } = await import("./logger.js");

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
    JWT_SECRET_len: String(JWT_SECRET).length
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
// CORS (FIX: liberar X-Widget-Key + OPTIONS correto pro WebChat)
// ===============================
function normalizeOrigin(o) {
  const s = String(o || "").trim();
  if (!s) return "";
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

// Origens "fixas" da plataforma (admin, app, dev)
const PLATFORM_ALLOWED_ORIGINS = [
  "https://cliente.gplabs.com.br",
  "https://gplabs.com.br",
  "https://www.gplabs.com.br",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
].map(normalizeOrigin);

// Lê allowedOrigins do WebChat via DB (Settings > Canais)
function getWebchatAllowedOriginsFromDB() {
  try {
    const db = loadDB();
    const allowed =
      db?.settings?.channels?.webchat?.allowedOrigins ||
      db?.channels?.webchat?.allowedOrigins || // compat antigo (se existir)
      [];
    return Array.isArray(allowed) ? allowed.map(normalizeOrigin).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// Middleware CORS por request (permite usar req.path)
function corsPerRequest(req, res, next) {
  const isWebchat = String(req.path || "").startsWith("/webchat");

  const dynamicWebchatOrigins = isWebchat ? getWebchatAllowedOriginsFromDB() : [];
  const allowedList = [...PLATFORM_ALLOWED_ORIGINS, ...dynamicWebchatOrigins]
    .map(normalizeOrigin)
    .filter(Boolean);

  const corsOptions = {
    origin(origin, cb) {
      // Sem origin = chamadas server-to-server / curl
      if (!origin) return cb(null, true);

      const o = normalizeOrigin(origin);
      if (allowedList.includes(o)) return cb(null, true);

      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // ✅ FIX CRÍTICO: liberar headers usados pelo widget
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "X-Widget-Key",
      "X-Webchat-Token"
    ],
    exposedHeaders: ["X-Request-Id"]
  };

  return cors(corsOptions)(req, res, next);
}

app.use(corsPerRequest);
app.options("*", corsPerRequest);

// ===============================
// PARSERS
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// ✅ PROD: SEM LOGIN PADRÃO / SEM AUTO-CRIAÇÃO
// ===============================
// (intencionalmente vazio — o primeiro admin entra via payload no db)

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

// Auth
app.use("/auth", passwordRouter);

// WebChat + Channels
app.use("/webchat", webchatRouter);
app.use("/settings/channels", channelsRouter);

// Conversas
app.use("/conversations", conversationsRouter);

// WhatsApp Webhook
app.use("/webhook/whatsapp", whatsappRouter);

// ===============================
// OUTBOUND
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
// LOGIN
// ===============================
app.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "Informe e-mail e senha." });
  }

  const db = loadDB();
  const users = ensureArray(db.users);

  const user = users.find((u) => u.email === email);
  if (!user || user.isActive === false) {
    return res.status(401).json({ error: "Usuário inválido." });
  }

  const ok =
    (user.passwordHash && verifyPassword(password, user.passwordHash)) ||
    (!user.passwordHash && password === user.password);

  if (!ok) {
    return res.status(401).json({ error: "Senha incorreta." });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  const { password: _p, passwordHash: _ph, ...safeUser } = user;
  res.json({ token, user: safeUser });
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
