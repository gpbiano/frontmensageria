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

// GET /settings/channels
router.get("/", requireAuth, requireRole("admin", "manager"), async (req, res) => {
  const db = loadDB();
  const channels = getChannels(db);
  saveDB(db);

  res.json({
    ...envInfo(),
    channels
  });
});

// GET /settings/channels/webchat
router.get(
  "/webchat",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    const channels = getChannels(db);
    saveDB(db);

    res.json({
      ...envInfo(),
      webchat: channels.webchat
    });
  }
);

// PATCH /settings/channels/webchat
router.patch(
  "/webchat",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    getChannels(db); // garante defaults

    const patch = req.body || {};
    const webchat = updateWebchatChannel(db, patch);

    saveDB(db);

    res.json({
      ok: true,
      ...envInfo(),
      webchat
    });
  }
);

// POST /settings/channels/webchat/rotate-key
router.post(
  "/webchat/rotate-key",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    getChannels(db); // garante defaults

    const out = rotateWebchatKey(db);
    saveDB(db);

    res.json({
      ok: true,
      ...envInfo(),
      ...out
    });
  }
);

// GET /settings/channels/webchat/snippet
router.get(
  "/webchat/snippet",
  requireAuth,
  requireRole("admin", "manager"),
  async (req, res) => {
    const db = loadDB();
    const channels = getChannels(db);
    saveDB(db);

    // URL pública do widget.js (você pode setar no .env)
    const widgetJsUrl =
      process.env.WIDGET_PUBLIC_URL ||
      "https://widget.gplabs.com.br/widget.js";

    // API base opcional (dev costuma precisar)
    // - prioriza query ?apiBase=
    // - depois env PUBLIC_API_BASE
    const apiBase =
      (req.query.apiBase ? String(req.query.apiBase) : "") ||
      process.env.PUBLIC_API_BASE ||
      "";

    const scriptTag = buildWebchatSnippet({
      widgetJsUrl,
      widgetKey: channels.webchat.widgetKey,
      apiBase
    });

    res.json({
      ok: true,
      ...envInfo(),
      widgetJsUrl,
      widgetKey: channels.webchat.widgetKey,
      allowedOrigins: channels.webchat.allowedOrigins || [],
      scriptTag
    });
  }
);

export default router;
