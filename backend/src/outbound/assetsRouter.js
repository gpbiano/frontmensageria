// backend/src/outbound/assetsRouter.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

const router = express.Router();

// ===============================
// CONFIG
// ===============================
// ⚠️ Sem fallback inseguro em produção
function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) {
    if ((process.env.NODE_ENV || "development") !== "production") {
      logger?.warn?.("⚠️ JWT_SECRET ausente. Usando secret dev APENAS em development.");
      return "gplabs-dev-secret";
    }
    throw new Error("JWT_SECRET não definido.");
  }
  return secret;
}

const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "")
  .trim()
  .replace(/\/+$/, "");

const DATA_FILE = path.resolve(process.cwd(), "data.json");
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ASSETS_DIR = path.join(UPLOADS_DIR, "assets");

// garante pastas
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ===============================
// AUTH
// ===============================
function requireAuth(req, res, next) {
  try {
    const h = String(req.headers.authorization || "");
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
    if (!token) return res.status(401).json({ error: "missing_token" });
    req.user = jwt.verify(token, getJwtSecret());
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// ===============================
// HELPERS
// ===============================
function nowIso() {
  return new Date().toISOString();
}

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    logger?.warn?.({ err, filePath }, "⚠️ Falha ao ler JSON (fallback)");
    return fallback;
  }
}

function safeWriteJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    logger?.error?.({ err, filePath }, "❌ Falha ao salvar JSON");
    return false;
  }
}

function loadDB() {
  const parsed = safeReadJSON(DATA_FILE, {});
  return parsed && typeof parsed === "object" ? parsed : {};
}

function saveDB(db) {
  return safeWriteJSON(DATA_FILE, db && typeof db === "object" ? db : {});
}

function ensureDbShape(db) {
  if (!db || typeof db !== "object") db = {};
  if (!Array.isArray(db.assets)) db.assets = [];
  return db;
}

function makeId() {
  return `asset_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeName(name) {
  return String(name || "file")
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-]/g, "");
}

function getPublicUrl(req, publicPath) {
  const base =
    PUBLIC_BASE_URL ||
    `${String(req.headers["x-forwarded-proto"] || req.protocol || "http")}://${String(
      req.headers["x-forwarded-host"] || req.get("host")
    )}`;
  return `${String(base).replace(/\/+$/, "")}${publicPath}`;
}

function tryDeleteFileByUrl(url) {
  try {
    const marker = "/uploads/assets/";
    const u = String(url || "");
    const pos = u.indexOf(marker);
    const filename = pos >= 0 ? u.slice(pos + marker.length) : null;
    if (!filename) return;

    const filePath = path.join(ASSETS_DIR, filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}

// ===============================
// MULTER (DISK)
// ===============================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSETS_DIR),
  filename: (req, file, cb) => {
    const original = sanitizeName(file.originalname);
    const ext = path.extname(original);
    const base = path.basename(original, ext);
    cb(null, `${Date.now()}-${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 } // 25MB
});

// =====================
// GET /outbound/assets
// =====================
router.get("/", requireAuth, (req, res) => {
  const db = ensureDbShape(loadDB());
  return res.json(db.assets);
});

// =============================
// POST /outbound/assets/upload
// field: file
// =============================
router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file_required" });

  const db = ensureDbShape(loadDB());
  const publicPath = `/uploads/assets/${file.filename}`;

  const item = {
    id: makeId(),
    name: file.originalname,
    label: file.originalname,
    type: file.mimetype,
    size: file.size,
    url: getPublicUrl(req, publicPath),
    createdAt: nowIso()
  };

  db.assets.unshift(item);
  saveDB(db);

  return res.status(201).json(item);
});

// ==========================
// DELETE /outbound/assets/:id
// ==========================
router.delete("/:id", requireAuth, (req, res) => {
  const { id } = req.params;

  const db = ensureDbShape(loadDB());
  const idx = db.assets.findIndex((a) => String(a.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "not_found" });

  const [removed] = db.assets.splice(idx, 1);
  saveDB(db);

  // best-effort delete file
  tryDeleteFileByUrl(removed?.url);

  return res.json({ success: true });
});

export default router;
