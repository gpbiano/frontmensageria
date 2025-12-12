// backend/src/outbound/optoutRouter.js
import express from "express";
import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import logger from "../logger.js";

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || "gplabs-dev-secret";

// arquivos na raiz do backend (mesmo cwd do index.js)
const OPTOUT_FILE = path.resolve(process.cwd(), "optout.json");
const DATA_FILE = path.resolve(process.cwd(), "data.json");

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
// HELPERS
// ===============================
function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function ensureJSONArrayFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, "[]", "utf8");
      return;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) fs.writeFileSync(filePath, "[]", "utf8");
  } catch (err) {
    logger.error({ err, filePath }, "❌ Falha ao garantir arquivo JSON array");
  }
}

function safeReadJSON(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || !raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    logger.error({ err, filePath }, "❌ Falha ao ler/parsear JSON (retornando fallback)");
    return fallback;
  }
}

function safeWriteJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    return true;
  } catch (err) {
    logger.error({ err, filePath }, "❌ Falha ao salvar JSON");
    return false;
  }
}

function loadOptOutArray() {
  ensureJSONArrayFile(OPTOUT_FILE);
  const parsed = safeReadJSON(OPTOUT_FILE, []);
  return Array.isArray(parsed) ? parsed : [];
}

function loadContactsArrayFromData() {
  const parsed = safeReadJSON(DATA_FILE, null);

  // data.json pode não existir ainda / ou pode estar inválido
  if (!parsed || typeof parsed !== "object") return [];

  const contacts = parsed.contacts;
  return Array.isArray(contacts) ? contacts : [];
}

// ===============================
// GET /outbound/optout?page=1&limit=25
// ===============================
router.get("/", requireAuth, (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(1, Number(req.query.limit || 25)));

    const items = loadOptOutArray();

    const start = (page - 1) * limit;
    const end = start + limit;

    return res.json({
      data: items.slice(start, end),
      total: items.length,
      page,
      limit
    });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no GET /outbound/optout");
    return res.status(200).json({ data: [], total: 0, page: 1, limit: 25 });
  }
});

// ===============================
// GET /outbound/optout/whatsapp-contacts
// Retorna contatos do data.json que NÃO estão em opt-out
// ===============================
router.get("/whatsapp-contacts", requireAuth, (req, res) => {
  try {
    const contacts = loadContactsArrayFromData();
    const optout = loadOptOutArray();

    const optoutPhones = new Set(optout.map((o) => normalizePhone(o.phone)));

    const available = contacts.filter((c) => {
      const p = normalizePhone(c?.phone);
      if (!p) return false;
      return !optoutPhones.has(p);
    });

    return res.json({
      data: available,
      total: available.length
    });
  } catch (err) {
    logger.error(
      { err, OPTOUT_FILE, DATA_FILE, cwd: process.cwd() },
      "❌ Erro inesperado no GET /outbound/optout/whatsapp-contacts"
    );
    // não derruba a tela — devolve vazio
    return res.status(200).json({ data: [], total: 0 });
  }
});

// ===============================
// POST /outbound/optout
// ===============================
router.post("/", requireAuth, (req, res) => {
  try {
    const { phone, name, reason, source } = req.body || {};
    if (!phone) return res.status(400).json({ error: "phone_required" });

    const items = loadOptOutArray();
    const p = normalizePhone(phone);

    if (items.some((i) => normalizePhone(i.phone) === p)) {
      return res.status(200).json({ success: true, duplicate: true });
    }

    items.unshift({
      id: `opt_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      phone: p,
      name: name ? String(name) : "",
      reason: reason ? String(reason) : "",
      source: source ? String(source) : "manual",
      createdAt: new Date().toISOString()
    });

    const ok = safeWriteJSON(OPTOUT_FILE, items);
    if (!ok) return res.status(500).json({ error: "persist_failed" });

    return res.status(201).json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no POST /outbound/optout");
    return res.status(500).json({ error: "internal_error" });
  }
});

// ===============================
// DELETE /outbound/optout/:id
// ===============================
router.delete("/:id", requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const items = loadOptOutArray();

    const idx = items.findIndex((i) => String(i.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: "not_found" });

    items.splice(idx, 1);

    const ok = safeWriteJSON(OPTOUT_FILE, items);
    if (!ok) return res.status(500).json({ error: "persist_failed" });

    return res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "❌ Erro inesperado no DELETE /outbound/optout/:id");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
