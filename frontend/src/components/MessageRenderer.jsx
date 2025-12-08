// frontend/src/components/MessageRenderer.jsx
import React from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

function buildMediaUrl(mediaUrl) {
  if (!mediaUrl) return null;

  // Se já vier com http/https, usa direto
  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    return mediaUrl;
  }

  // Se vier só /uploads/xyz, prefixa com a API
  return `${API_BASE}${mediaUrl}`;
}

export default function MessageRenderer({ message, isOwnMessage }) {
  const timeLabel = message.timestamp
    ? new Date(message.timestamp).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  const mediaUrl = buildMediaUrl(message.mediaUrl);
  const location = message.location;

  let content;

  // ===============================
  // TIPOS DE MENSAGEM
  // ===============================
  if (message.type === "image") {
    content = mediaUrl ? (
      <div style={{ maxWidth: 280 }}>
        <img
          src={mediaUrl}
          alt={message.text || "Imagem recebida"}
          style={{
            width: "100%",
            height: "auto",
            borderRadius: 12,
            display: "block",
          }}
        />
        {message.text && (
          <div style={{ marginTop: 6, fontSize: "0.85rem" }}>
            {message.text}
          </div>
        )}
      </div>
    ) : (
      <span>Imagem recebida (sem preview)</span>
    );
  } else if (message.type === "video") {
    content = mediaUrl ? (
      <div style={{ maxWidth: 280 }}>
        <video
          src={mediaUrl}
          controls
          style={{
            width: "100%",
            borderRadius: 12,
            display: "block",
          }}
        />
        {message.text && (
          <div style={{ marginTop: 6, fontSize: "0.85rem" }}>
            {message.text}
          </div>
        )}
      </div>
    ) : (
      <span>Vídeo recebido (sem preview)</span>
    );
  } else if (message.type === "audio") {
    content = mediaUrl ? (
      <audio controls src={mediaUrl} style={{ width: 240 }} />
    ) : (
      <span>Áudio recebido</span>
    );
  } else if (message.type === "document") {
    const label = message.text || "Abrir arquivo";
    content = mediaUrl ? (
      <a
        href={mediaUrl}
        target="_blank"
        rel="noreferrer"
        style={{ textDecoration: "underline" }}
      >
        {label}
      </a>
    ) : (
      <span>{label}</span>
    );
  } else if (message.type === "sticker") {
    content = mediaUrl ? (
      <img
        src={mediaUrl}
        alt="Figurinha"
        style={{
          width: 128,
          height: 128,
          objectFit: "contain",
          borderRadius: 12,
          display: "block",
        }}
      />
    ) : (
      <span>Figurinha recebida</span>
    );
  } else if (message.type === "location" && location) {
    const { latitude, longitude, name, address } = location;

    const mapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${
      longitude - 0.01
    },${latitude - 0.01},${longitude + 0.01},${
      latitude + 0.01
    }&layer=mapnik&marker=${latitude},${longitude}`;

    const mapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

    content = (
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
            title="Localização enviada"
            src={mapSrc}
            style={{ width: "100%", height: 180, border: "none" }}
            loading="lazy"
          />
        </div>

        <div style={{ fontSize: "0.85rem", marginBottom: 4 }}>
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
  } else {
    // Texto puro ou fallback
    content = <span>{message.text}</span>;
  }

  // ===============================
  // BOLHA + METADADOS
  // ===============================
  return (
    <div
      className={`message-bubble ${isOwnMessage ? "outgoing" : "incoming"}`}
    >
      <div className="message-content">{content}</div>
      {timeLabel && (
        <div className="message-meta">
          <span>{timeLabel}</span>
        </div>
      )}
    </div>
  );
}


