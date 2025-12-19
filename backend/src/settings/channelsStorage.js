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

/**
 * Escape seguro para atributos HTML
 */
function escapeAttr(v) {
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * =========================
 * GET CHANNELS (NORMALIZADO)
 * =========================
 */
export function getChannels(db) {
  ensureDbShape(db);
  const ch = db.settings.channels;

  // =========================
  // WEBCHAT
  // =========================
  if (!ch.webchat) {
    ch.webchat = {
      enabled: false,
      status: "not_connected",
      widgetKey: newWidgetKey(),
      allowedOrigins: [],
      config: {
        primaryColor: "#34d399",
        color: "#34d399",
        position: "right",
        buttonText: "Ajuda",
        headerTitle: "Atendimento",
        title: "Atendimento",
        greeting: "Olá! Como posso ajudar?"
      },
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  // =========================
  // WHATSAPP
  // =========================
  if (!ch.whatsapp) {
    ch.whatsapp = {
      enabled: true,
      status: "connected",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  // =========================
  // MESSENGER (FUTURO)
  // =========================
  if (!ch.messenger) {
    ch.messenger = {
      enabled: false,
      status: "soon",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  // =========================
  // INSTAGRAM (FUTURO)
  // =========================
  if (!ch.instagram) {
    ch.instagram = {
      enabled: false,
      status: "soon",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
  }

  db.settings.channels = ch;

  return [
    {
      id: "whatsapp",
      name: "WhatsApp Cloud API",
      description: "Canal oficial do WhatsApp via Meta Cloud API.",
      ...ch.whatsapp
    },
    {
      id: "webchat",
      name: "Web Chat (Widget)",
      description: "Widget de atendimento para seu site.",
      ...ch.webchat
    },
    {
      id: "messenger",
      name: "Facebook Messenger",
      description: "Integração com Facebook Messenger (em breve).",
      ...ch.messenger
    },
    {
      id: "instagram",
      name: "Instagram Direct",
      description: "Atendimento via Instagram Direct (em breve).",
      ...ch.instagram
    }
  ];
}

/**
 * =========================
 * UPDATE WEBCHAT
 * =========================
 */
export function updateWebchatChannel(db, patch) {
  ensureDbShape(db);
  const ch = db.settings.channels;

  const next = { ...ch.webchat };

  if (typeof patch.enabled === "boolean") {
    next.enabled = patch.enabled;
  }

  if (Array.isArray(patch.allowedOrigins)) {
    next.allowedOrigins = patch.allowedOrigins
      .map((o) => String(o || "").trim())
      .filter(Boolean)
      .map((o) => o.replace(/\/+$/, ""));
  }

  if (patch.config && typeof patch.config === "object") {
    next.config = {
      ...next.config,
      ...patch.config
    };

    // 🔁 Compatibilidade total frontend/backend
    if (next.config.primaryColor && !next.config.color) {
      next.config.color = next.config.primaryColor;
    }
    if (next.config.color && !next.config.primaryColor) {
      next.config.primaryColor = next.config.color;
    }

    if (next.config.headerTitle && !next.config.title) {
      next.config.title = next.config.headerTitle;
    }
    if (next.config.title && !next.config.headerTitle) {
      next.config.headerTitle = next.config.title;
    }

    if (next.config.position !== "left") next.config.position = "right";
    if (!next.config.color) next.config.color = "#34d399";
    if (!next.config.primaryColor) next.config.primaryColor = next.config.color;
  }

  // status derivado
  next.status = next.enabled ? "connected" : "disabled";
  next.updatedAt = nowIso();

  ch.webchat = next;
  return ch.webchat;
}

/**
 * =========================
 * ROTATE WIDGET KEY
 * =========================
 */
export function rotateWebchatKey(db) {
  ensureDbShape(db);

  db.settings.channels.webchat.widgetKey = newWidgetKey();
  db.settings.channels.webchat.updatedAt = nowIso();

  return {
    widgetKey: db.settings.channels.webchat.widgetKey
  };
}

/**
 * =========================
 * BUILD WEBCHAT SNIPPET (FINAL)
 * =========================
 */
export function buildWebchatSnippet({
  widgetJsUrl,
  widgetKey,
  apiBase,
  config
}) {
  const cfg = config && typeof config === "object" ? config : {};

  const color = String(cfg.primaryColor || cfg.color || "#34d399").trim();
  const position = cfg.position === "left" ? "left" : "right";
  const buttonText = String(cfg.buttonText || "Ajuda");
  const title = String(cfg.headerTitle || cfg.title || "Atendimento");
  const greeting = String(cfg.greeting || "Olá! Como posso ajudar?");

  const attrs = [
    `src="${widgetJsUrl}"`,
    `data-widget-key="${widgetKey}"`,
    `data-color="${escapeAttr(color)}"`,
    `data-position="${escapeAttr(position)}"`,
    `data-button-text="${escapeAttr(buttonText)}"`,
    `data-title="${escapeAttr(title)}"`,
    `data-greeting="${escapeAttr(greeting)}"`
  ];

  if (apiBase) {
    attrs.push(`data-api-base="${apiBase}"`);
  }

  return `<script ${attrs.join(" ")} async></script>`;
}
