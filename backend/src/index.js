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

// Routers estáticos
import webchatRouter from "./routes/webchat.js";
import channelsRouter from "./routes/channels.js";
import conversationsRouter from "./routes/conversations.js";
import smsCampaignsRouter from "./outbound/smsCampaignsRouter.js";

// ===============================
// ENV
// ===============================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENV = process.env.NODE_ENV || "development";
dotenv.config({ path: path.join(process.cwd(), `.env.${ENV}`) });

// ✅ Compat WhatsApp ENV (evita 500 em routers antigos)
if (!process.env.PHONE_NUMBER_ID && process.env.WHATSAPP_PHONE_NUMBER_ID) {
  process.env.PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
}
if (!process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.PHONE_NUMBER_ID) {
  process.env.WHATSAPP_PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
}

// compat VERIFY_TOKEN
if (!process.env.WHATSAPP_VERIFY_TOKEN && process.env.VERIFY_TOKEN) {
  process.env.WHATSAPP_VERIFY_TOKEN = process.env.VERIFY_TOKEN;
}

// logger
const { default: logger } = await import("./logger.js");

// Routers dinâmicos
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
const { default: whatsappRouter } = await import(
  "./routes/channels/whatsappRouter.js"
);

// ===============================
// VARS
// ===============================
const PORT = process.env.PORT || 3010;

// ✅ JWT_SECRET obrigatório (sem fallback para evitar invalid signature)
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error(
    "❌ JWT_SECRET não definido. Configure no .env.production (ou no ambiente do PM2)."
  );
}

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID; // ✅ canonical
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID; // ✅ compat (já espelhado acima)
const WABA_ID = process.env.WABA_ID;

// ✅ valor final único pra usar em logs/health
const EFFECTIVE_PHONE_NUMBER_ID =
  String(WHATSAPP_PHONE_NUMBER_ID || PHONE_NUMBER_ID || "").trim() || null;

logger.info(
  {
    PORT,
    WABA_ID,
    WHATSAPP_PHONE_NUMBER_ID: WHATSAPP_PHONE_NUMBER_ID || null,
    PHONE_NUMBER_ID: PHONE_NUMBER_ID || null,
    EFFECTIVE_PHONE_NUMBER_ID,
    WHATSAPP_TOKEN_defined: !!WHATSAPP_TOKEN
  },
  "✅ Ambiente carregado"
);

// ===============================
// HANDLERS NODE
// ===============================
process.on("unhandledRejection", (r) =>
  logger.error({ r }, "UnhandledRejection")
);
process.on("uncaughtException", (e) => {
  logger.fatal({ e }, "UncaughtException");
  process.exit(1);
});

// ===============================
// UPLOADS
// ===============================
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
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
// CORS
// ===============================
const ALLOWED_ORIGINS = [
  "https://cliente.gplabs.com.br",
  "https://gplabs.com.br",
  "http://localhost:5173"
];

app.use(
  cors({
    origin(origin, cb) {
      // permite calls server-to-server / curl sem Origin
      if (!origin) return cb(null, true);

      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
  })
);

// importante para preflight
app.options("*", cors());

// ===============================
// PARSERS
// ===============================
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

// ===============================
// ADMIN PADRÃO
// ===============================
(function ensureAdmin() {
  const db = loadDB();
  db.users = ensureArray(db.users);

  const email = "admin@gplabs.com.br";
  const now = new Date().toISOString();

  let user = db.users.find((u) => u.email === email);
  if (!user) {
    db.users.push({
      id: db.users.length + 1,
      name: "Administrador",
      email,
      password: "gplabs123",
      passwordHash: null,
      role: "admin",
      isActive: true,
      createdAt: now,
      updatedAt: now
    });
    saveDB(db);
    logger.info("👤 Admin padrão criado");
  }
})();

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

// Conversas (FONTE ÚNICA)
app.use("/conversations", conversationsRouter);

// WhatsApp Webhook (FONTE ÚNICA)
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

  // ✅ assina com o mesmo JWT_SECRET do requireAuth (sem fallback)
  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "8h" }
  );

  res.json({ token, user });
});

// ===============================
// ERROR HANDLER
// ===============================
app.use((err, req, res, next) => {
  logger.error({ err }, "Erro não tratado");
  res.status(500).json({ error: "Internal server error" });
});

// ===============================
// START
// ===============================
app.listen(PORT, () => {
  logger.info({ PORT }, "🚀 API rodando");
});
