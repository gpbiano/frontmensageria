// backend/src/outbound/assetsRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import multer from "multer";

const router = express.Router();

// pasta de uploads (a mesma que você já expõe em /uploads no index.js)
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ASSETS_DIR = path.join(UPLOADS_DIR, "assets");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

// um “mini banco” simples pra assets (sem depender do state do index.js)
const ASSETS_DB = path.join(process.cwd(), "assets.json");

function loadAssets() {
  try {
    if (!fs.existsSync(ASSETS_DB)) return [];
    const raw = fs.readFileSync(ASSETS_DB, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveAssets(list) {
  fs.writeFileSync(ASSETS_DB, JSON.stringify(list, null, 2), "utf8");
}

function toPublicUrl(req, publicPath) {
  // publicPath ex: /uploads/assets/arquivo.png
  return `${req.protocol}://${req.get("host")}${publicPath}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSETS_DIR),
  filename: (req, file, cb) => {
    const safe = (file.originalname || "file")
      .replace(/\s+/g, "_")
      .replace(/[^\w.\-]/g, "");
    cb(null, `${Date.now()}-${safe}`);
  }
});

const upload = multer({ storage });

// =====================
// GET /outbound/assets
// =====================
router.get("/", (req, res) => {
  const items = loadAssets();
  res.json(items);
});

// =============================
// POST /outbound/assets/upload
// field: file
// =============================
router.post("/upload", upload.single("file"), (req, res) => {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ error: "Arquivo não enviado (field: file)." });
  }

  const items = loadAssets();

  const publicPath = `/uploads/assets/${file.filename}`;

  const item = {
    id: String(Date.now()),
    name: file.originalname,
    type: file.mimetype,
    size: file.size,
    url: toPublicUrl(req, publicPath),
    createdAt: new Date().toISOString()
  };

  items.unshift(item);
  saveAssets(items);

  return res.status(201).json(item);
});

// ==========================
// DELETE /outbound/assets/:id
// ==========================
router.delete("/:id", (req, res) => {
  const { id } = req.params;
  const items = loadAssets();
  const idx = items.findIndex((a) => String(a.id) === String(id));

  if (idx === -1) return res.status(404).json({ error: "Arquivo não encontrado." });

  const [removed] = items.splice(idx, 1);
  saveAssets(items);

  // tenta apagar arquivo físico (melhor esforço)
  try {
    const url = removed.url || "";
    const filename = url.split("/uploads/assets/")[1];
    if (filename) {
      const filePath = path.join(ASSETS_DIR, filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  } catch {
    // ignora
  }

  return res.json({ success: true });
});

export default router;
