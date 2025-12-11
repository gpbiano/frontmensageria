// frontend/src/components/MessageRenderer.jsx
import React from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

/* ============================================================
   NORMALIZA URL DE MÍDIA
============================================================ */
function buildMediaUrl(url) {
  if (!url) return null;

  // Já é URL absoluta?
  if (/^https?:\/\//i.test(url)) return url;

  // /uploads/... → prefixa host da API
  return `${API_BASE}${url}`;
}

/* ============================================================
   COMPONENTE PRINCIPAL
============================================================ */
export default function MessageRenderer({ message, isOwnMessage }) {
  if (!message) return null;

  const type = (message.type || "").toLowerCase();
  const mediaUrl = buildMediaUrl(message.mediaUrl);
  const location = message.location;
  const isBot = message.isBot || message.fromBot;

  /* ============================================================
     FORMATAÇÃO DE HORA
  ============================================================ */
  const timeLabel = message.timestamp
    ? new Date(message.timestamp).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  /* ============================================================
     RENDERIZAR CONTEÚDO POR TIPO
  ============================================================ */
  let content;

  switch (type) {
    case "image":
      content = (
        <MediaImage url={mediaUrl} caption={message.text} fallback="Imagem" />
      );
      break;

    case "video":
      content = (
        <MediaVideo url={mediaUrl} caption={message.text} fallback="Vídeo" />
      );
      break;

    case "audio":
      content = <MediaAudio url={mediaUrl} />;
      break;

    case "document":
      content = <MediaDocument url={mediaUrl} label={message.text} />;
      break;

    case "sticker":
      content = <MediaSticker url={mediaUrl} />;
      break;

    case "location":
      content = <MediaLocation location={location} />;
      break;

    case "contact":
      content = <MediaContact message={message} />;
      break;

    default:
      content = <span>{message.text || "[mensagem sem conteúdo]"}</span>;
      break;
  }

  /* ============================================================
     BOLHA FINAL
  ============================================================ */
  return (
    <div className={`message-bubble ${isOwnMessage ? "outgoing" : "incoming"}`}>
      <div className="message-content">{content}</div>

      {timeLabel && (
        <div className="message-meta">
          <span>{timeLabel}</span>

          {isBot && (
            <span style={{ opacity: 0.75, marginLeft: 6, fontSize: "0.75rem" }}>
              · 🤖 Bot
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   SUBCOMPONENTES (MEDIA / LOCATION / CONTACT)
============================================================ */

function MediaImage({ url, caption, fallback }) {
  if (!url)
    return (
      <span>
        {fallback} recebida (sem preview)
      </span>
    );

  return (
    <div style={{ maxWidth: 280 }}>
      <img
        src={url}
        alt={caption || fallback}
        style={{
          width: "100%",
          borderRadius: 12,
          display: "block",
        }}
      />

      {caption && (
        <div style={{ marginTop: 6, fontSize: "0.85rem" }}>{caption}</div>
      )}
    </div>
  );
}

function MediaVideo({ url, caption, fallback }) {
  if (!url)
    return (
      <span>
        {fallback} recebida (sem preview)
      </span>
    );

  return (
    <div style={{ maxWidth: 280 }}>
      <video
        src={url}
        controls
        style={{
          width: "100%",
          borderRadius: 12,
          display: "block",
        }}
      />

      {caption && (
        <div style={{ marginTop: 6, fontSize: "0.85rem" }}>{caption}</div>
      )}
    </div>
  );
}

function MediaAudio({ url }) {
  if (!url) return <span>Áudio recebido</span>;

  return <audio controls src={url} style={{ width: 240 }} />;
}

function MediaDocument({ url, label }) {
  const text = label || "Abrir documento";

  if (!url) return <span>{text}</span>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{ textDecoration: "underline" }}
    >
      {text}
    </a>
  );
}

function MediaSticker({ url }) {
  if (!url) return <span>Figurinha</span>;

  return (
    <img
      src={url}
      alt="Figurinha"
      style={{
        width: 128,
        height: 128,
        objectFit: "contain",
        borderRadius: 12,
        display: "block",
      }}
    />
  );
}

function MediaLocation({ location }) {
  if (!location) return <span>Localização enviada</span>;

  const { latitude, longitude, name, address } = location;

  const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${
    longitude - 0.01
  },${latitude - 0.01},${longitude + 0.01},${
    latitude + 0.01
  }&layer=mapnik&marker=${latitude},${longitude}`;

  const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

  return (
    <div style={{ width: 280 }}>
      <div
        style={{
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid rgba(255,255,255,0.08)",
          marginBottom: 8,
        }}
      >
        <iframe
          loading="lazy"
          title="Localização enviada"
          src={mapSrc}
          style={{ width: "100%", height: 180, border: "none" }}
        />
      </div>

      <div style={{ fontSize: "0.85rem", marginBottom: 6 }}>
        <strong>Localização enviada</strong>
        <br />

        {name && (
          <>
            {name}
            <br />
          </>
        )}

        {address && (
          <>
            {address}
            <br />
          </>
        )}

        Lat: {latitude}, Long: {longitude}
      </div>

      <a
        href={mapsLink}
        target="_blank"
        rel="noreferrer"
        style={{ fontSize: "0.85rem", textDecoration: "underline" }}
      >
        Abrir no Google Maps
      </a>
    </div>
  );
}

function MediaContact({ message }) {
  const contact = message.contact || {};
  const phones = Array.isArray(contact.phones) ? contact.phones : [];

  return (
    <div style={{ minWidth: 220, maxWidth: 300 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: "1.1rem" }}>📇</span>
        <span style={{ fontWeight: 600 }}>
          {contact.name || message.text || "Contato enviado"}
        </span>
      </div>

      {contact.org && (
        <div style={{ fontSize: "0.8rem", opacity: 0.8, marginBottom: 4 }}>
          {contact.org}
        </div>
      )}

      {phones.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "4px 0 8px",
            fontSize: "0.8rem",
          }}
        >
          {phones.map((p, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              {p.phone || p.wa_id}
              {p.type && <span style={{ opacity: 0.7 }}> · {p.type}</span>}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        style={{
          marginTop: 4,
          fontSize: "0.75rem",
          padding: "4px 10px",
          borderRadius: 999,
          border: "1px solid rgba(52,211,153,0.9)",
          background: "transparent",
          color: "#34D399",
          cursor: "pointer",
        }}
      >
        Adicionar à agenda
      </button>
    </div>
  );
}
