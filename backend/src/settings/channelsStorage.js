// backend/src/settings/channelsStorage.js
import crypto from "crypto";

function nowIso() {
  return new Date().toISOString();
}

function newWidgetKey() {
  return `wkey_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function ensureDbShape(db) {
  if (!db.settings) db.settings = {};
  if (!db.settings.channels) db.settings.channels = {};
  return db;
}

export function getChannels(db) {
  ensureDbShape(db);

  const ch = db.settings.channels;

  // Defaults (mantém retrocompatibilidade e evita quebrar o front)
  if (!ch.webchat) {
    ch.webchat = {
      enabled: false,
      status: "not_connected", // not_connected | connected | disabled
      widgetKey: newWidgetKey(),
      allowedOrigins: [],
      config: {
        color: "#34d399",
        position: "right", // right | left
        buttonText: "Ajuda",
        title: "Atendimento",
        greeting: "Olá! Como posso ajudar?"
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  if (!ch.whatsapp) {
    ch.whatsapp = {
      enabled: true,
      status: "connected", // connected | not_connected | disabled
      updatedAt: nowIso()
    };
  }

  if (!ch.messenger) {
    ch.messenger = {
      enabled: false,
      status: "soon",
      updatedAt: nowIso()
    };
  }

  if (!ch.instagram) {
    ch.instagram = {
      enabled: false,
      status: "soon",
      updatedAt: nowIso()
    };
  }

  db.settings.channels = ch;
  return db.settings.channels;
}

export function updateWebchatChannel(db, patch) {
  const channels = getChannels(db);

  const next = { ...channels.webchat };

  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;

  if (Array.isArray(patch.allowedOrigins)) {
    // normaliza origins
    next.allowedOrigins = patch.allowedOrigins
      .map((o) => String(o || "").trim())
      .filter(Boolean)
      .map((o) => o.replace(/\/+$/, "")); // remove trailing slash
  }

  if (patch.config && typeof patch.config === "object") {
    next.config = {
      ...next.config,
      ...patch.config
    };

    // normalizações simples
    if (next.config.position !== "left") next.config.position = "right";
    if (typeof next.config.color !== "string" || !next.config.color.trim()) {
      next.config.color = "#34d399";
    }
  }

  // status derivado
  if (!next.enabled) next.status = "disabled";
  else next.status = "connected";

  next.updatedAt = nowIso();

  channels.webchat = next;
  db.settings.channels = channels;

  return channels.webchat;
}

export function rotateWebchatKey(db) {
  const channels = getChannels(db);
  channels.webchat.widgetKey = newWidgetKey();
  channels.webchat.updatedAt = nowIso();
  db.settings.channels = channels;
  return { widgetKey: channels.webchat.widgetKey };
}

export function buildWebchatSnippet({ widgetJsUrl, widgetKey, apiBase }) {
  const attrs = [
    `src="${widgetJsUrl}"`,
    `data-widget-key="${widgetKey}"`
  ];

  // opcional (útil no dev / multicliente / ambientes)
  if (apiBase) attrs.push(`data-api-base="${apiBase}"`);

  return `<script ${attrs.join(" ")} async></script>`;
}
