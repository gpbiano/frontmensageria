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
 * Retorna TODOS os canais normalizados
 * (formato amigável pro front)
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
      status: "not_connected", // not_connected | connected | disabled
      widgetKey: newWidgetKey(),
      allowedOrigins: [],
      config: {
        color: "#34d399",
        position: "right",
        buttonText: "Ajuda",
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
      status: "connected", // connected | not_connected | disabled
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

  // 🔹 Retorno NORMALIZADO para o front
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
 * Atualiza APENAS o canal Webchat
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

    if (next.config.position !== "left") next.config.position = "right";
    if (!next.config.color) next.config.color = "#34d399";
  }

  // status derivado
  if (!next.enabled) next.status = "disabled";
  else next.status = "connected";

  next.updatedAt = nowIso();
  ch.webchat = next;

  return ch.webchat;
}

/**
 * Rotaciona a widgetKey do Webchat
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
 * Gera o snippet do Webchat
 */
export function buildWebchatSnippet({ widgetJsUrl, widgetKey, apiBase }) {
  const attrs = [
    `src="${widgetJsUrl}"`,
    `data-widget-key="${widgetKey}"`
  ];

  if (apiBase) {
    attrs.push(`data-api-base="${apiBase}"`);
  }

  return `<script ${attrs.join(" ")} async></script>`;
}
