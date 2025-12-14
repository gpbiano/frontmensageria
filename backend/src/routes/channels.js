// backend/src/routes/channels.js
import express from "express";
import { loadDB, saveDB } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";
import {
  getChannels,
  updateWebchatChannel,
  rotateWebchatKey,
  buildWebchatSnippet
} from "../settings/channelsStorage.js";

const router = express.Router();

function envInfo() {
  const env = process.env.NODE_ENV || "development";
  return { env };
}

function ensureChannelsAndReturn(db) {
  // getChannels garante defaults e agora retorna LISTA (array)
  const channelsList = getChannels(db);
  const channelsMap = db?.settings?.channels || {};
  return { channelsList, channelsMap };
}

// ======================================================
// GET /settings/channels
// Retorna lista (array) para o front
// ======================================================
router.get(
  "/",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    const { channelsList, channelsMap } = ensureChannelsAndReturn(db);
    saveDB(db);

    return res.json({
      ...envInfo(),
      channels: channelsList, // ✅ formato pro front
      channelsMap // ✅ retrocompatibilidade (se algo antigo usava objeto)
    });
  }
);

// ======================================================
// GET /settings/channels/webchat
// ======================================================
router.get(
  "/webchat",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    ensureChannelsAndReturn(db);
    saveDB(db);

    return res.json({
      ...envInfo(),
      webchat: db?.settings?.channels?.webchat || null
    });
  }
);

// ======================================================
// PATCH /settings/channels/webchat
// ======================================================
router.patch(
  "/webchat",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    ensureChannelsAndReturn(db); // garante defaults

    const patch = req.body || {};
    const webchat = updateWebchatChannel(db, patch);

    saveDB(db);

    return res.json({
      ok: true,
      ...envInfo(),
      webchat
    });
  }
);

// ======================================================
// POST /settings/channels/webchat/rotate-key
// ======================================================
router.post(
  "/webchat/rotate-key",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    ensureChannelsAndReturn(db); // garante defaults

    const out = rotateWebchatKey(db);
    saveDB(db);

    return res.json({
      ok: true,
      ...envInfo(),
      ...out
    });
  }
);

// ======================================================
// GET /settings/channels/webchat/snippet
// ======================================================
router.get(
  "/webchat/snippet",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    ensureChannelsAndReturn(db);
    saveDB(db);

    const webchat = db?.settings?.channels?.webchat || {};

    // URL pública do widget.js (você pode setar no .env)
    const widgetJsUrl =
      process.env.WIDGET_PUBLIC_URL ||
      "https://widget.gplabs.com.br/widget.js";

    // API base opcional
    // - prioriza query ?apiBase=
    // - depois env PUBLIC_API_BASE
    // - fallback: api.gplabs.com.br (sua API)
    const apiBase =
      (req.query.apiBase ? String(req.query.apiBase) : "") ||
      process.env.PUBLIC_API_BASE ||
      "https://api.gplabs.com.br";

    const scriptTag = buildWebchatSnippet({
      widgetJsUrl,
      widgetKey: webchat.widgetKey,
      apiBase
    });

    return res.json({
      ok: true,
      ...envInfo(),
      widgetJsUrl,
      widgetKey: webchat.widgetKey,
      allowedOrigins: webchat.allowedOrigins || [],
      scriptTag
    });
  }
);

export default router;
