// backend/src/outbound/assetsRouter.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";

const router = express.Router();

// ===============================
// CONFIG
// ===============================
const JWT_SECRET = process.env.JWT_SECRET || "gplabs-dev-secret";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ASSETS_DIR = path.join(UPLOADS_DIR, "assets");
const ASSETS_DB = path.join(process.cwd(), "assets.json");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// ===============================
// AUTH
// ===============================
function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "missing_token" });
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

// ===============================
// FILE IO
// ===============================
function safeReadJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = raw ? JSON.parse(raw) : fallback;
    return parsed;
  } catch {
    return fallback;
  }
}

function safeWriteJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function loadAssets() {
  const parsed = safeReadJson(ASSETS_DB, []);
  return Array.isArray(parsed) ? parsed : [];
}

function saveAssets(list) {
  safeWriteJson(ASSETS_DB, Array.isArray(list) ? list : []);
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
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${publicPath}`;
}

// ===============================
// MULTER
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
  return res.json(loadAssets());
});

// =============================
// POST /outbound/assets/upload
// field: file
// =============================
router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file_required" });

  const items = loadAssets();
  const publicPath = `/uploads/assets/${file.filename}`;

  const item = {
    id: makeId(),
    name: file.originalname,
    label: file.originalname,
    type: file.mimetype,
    size: file.size,
    url: getPublicUrl(req, publicPath),
    createdAt: new Date().toISOString()
  };

  items.unshift(item);
  saveAssets(items);

  return res.status(201).json(item);
});

// ==========================
// DELETE /outbound/assets/:id
// ==========================
router.delete("/:id", requireAuth, (req, res) => {
  const { id } = req.params;

  const items = loadAssets();
  const idx = items.findIndex((a) => String(a.id) === String(id));
  if (idx === -1) return res.status(404).json({ error: "not_found" });

  const [removed] = items.splice(idx, 1);
  saveAssets(items);

  // best-effort delete file
  try {
    const marker = "/uploads/assets/";
    const url = String(removed.url || "");
    const pos = url.indexOf(marker);
    const filename = pos >= 0 ? url.slice(pos + marker.length) : null;

    if (filename) {
      const filePath = path.join(ASSETS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch {
    // ignore
  }

  return res.json({ success: true });
});

export default router;
