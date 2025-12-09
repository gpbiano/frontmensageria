// backend/src/outbound/assetsRouter.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import logger from "../logger.js";

const router = express.Router();

// pasta onde os arquivos serão armazenados
const ASSETS_DIR = path.join(process.cwd(), "uploads/assets");

if (!fs.existsSync(ASSETS_DIR)) {
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
}

// limite de 1MB
const upload = multer({
  limits: { fileSize: 1 * 1024 * 1024 },
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ASSETS_DIR),
    filename: (req, file, cb) => {
      const timestamp = Date.now();
      const ext = path.extname(file.originalname) || "";
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${timestamp}-${safeName}${ext}`);
    }
  })
});

// arquivo JSON para persistência simples
const ASSETS_DB = path.join(process.cwd(), "assets.json");

// Carregar dados
function loadAssets() {
  try {
    if (!fs.existsSync(ASSETS_DB)) return [];
    const raw = fs.readFileSync(ASSETS_DB, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    logger.error({ err }, "Erro ao carregar assets.json");
    return [];
  }
}

// Salvar dados
function saveAssets(data) {
  try {
    fs.writeFileSync(ASSETS_DB, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error({ err }, "Erro ao salvar assets.json");
  }
}

// ===============================
// GET /outbound/assets
// ===============================
router.get("/outbound/assets", (req, res) => {
  const list = loadAssets();
  res.json(list);
});

// ===============================
// POST /outbound/assets (upload)
// ===============================
router.post("/outbound/assets", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado." });
  }

  const assets = loadAssets();

  const newAsset = {
    id: Date.now(),
    name: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    type: req.file.mimetype,
    uploadedAt: new Date().toISOString(),
    url: `/uploads/assets/${req.file.filename}`
  };

  assets.push(newAsset);
  saveAssets(assets);

  logger.info({ file: newAsset.filename }, "📁 Novo arquivo enviado");

  res.status(201).json(newAsset);
});

// ===============================
// DELETE /outbound/assets/:id
// ===============================
router.delete("/outbound/assets/:id", (req, res) => {
  const { id } = req.params;

  let assets = loadAssets();
  const asset = assets.find((a) => a.id == id);

  if (!asset) {
    return res.status(404).json({ error: "Arquivo não encontrado." });
  }

  // remover arquivo físico
  const filePath = path.join(ASSETS_DIR, asset.filename);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // remover do banco
  assets = assets.filter((a) => a.id != id);
  saveAssets(assets);

  logger.info({ id }, "🗑️ Arquivo deletado");
  res.json({ success: true });
});

export default router;
