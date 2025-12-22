// backend/src/outbound/assetsRouter.js
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import prisma from "../lib/prisma.js";
import logger from "../logger.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = express.Router();

const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const ASSETS_DIR = path.join(UPLOADS_DIR, "assets");

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(ASSETS_DIR)) fs.mkdirSync(ASSETS_DIR, { recursive: true });

function sanitizeName(name) {
  return String(name || "file")
    .replace(/\s+/g, "_")
    .replace(/[^\w.\-]/g, "");
}

function getTenantId(req) {
  const tid = req.tenant?.id || req.user?.tenantId || null;
  return tid ? String(tid) : null;
}

function getPublicUrl(req, publicPath) {
  const base = PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}${publicPath}`;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ASSETS_DIR),
  filename: (_req, file, cb) => {
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
router.get("/", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const items = await prisma.asset.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" }
    });

    return res.json(items);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ assetsRouter GET / failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

// =============================
// POST /outbound/assets/upload
// field: file
// =============================
router.post("/upload", requireAuth, upload.single("file"), async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const file = req.file;
    if (!file) return res.status(400).json({ error: "file_required" });

    const publicPath = `/uploads/assets/${file.filename}`;
    const storageKey = `uploads/assets/${file.filename}`;

    const item = await prisma.asset.create({
      data: {
        tenantId,
        name: String(file.originalname || file.filename),
        label: String(file.originalname || file.filename),
        mimeType: String(file.mimetype || ""),
        size: Number(file.size || 0),
        storageKey,
        url: getPublicUrl(req, publicPath)
      }
    });

    return res.status(201).json(item);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ assetsRouter POST /upload failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

// ==========================
// DELETE /outbound/assets/:id
// ==========================
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const { id } = req.params;

    const asset = await prisma.asset.findFirst({
      where: { id: String(id), tenantId }
    });
    if (!asset) return res.status(404).json({ error: "not_found" });

    await prisma.asset.delete({ where: { id: asset.id } });

    // best-effort delete file
    try {
      const marker = "uploads/assets/";
      const key = String(asset.storageKey || "");
      const filename = key.includes(marker) ? key.split(marker).pop() : null;

      if (filename) {
        const filePath = path.join(ASSETS_DIR, filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    } catch {
      // ignore
    }

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ assetsRouter DELETE /:id failed");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
