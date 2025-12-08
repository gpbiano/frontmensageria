// backend/src/chatbot/whatsappMedia.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import logger from "../logger.js";

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

/**
 * Garante que a pasta /uploads exista.
 */
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  logger.info({ UPLOADS_DIR }, "📁 Pasta de uploads criada");
}

/**
 * Resolve a URL pública de uma mídia a partir do mediaId.
 * Usa a Graph API: GET /{media-id}?redirect=false
 */
async function resolveMediaUrlFromId(mediaId) {
  if (!WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN não definido para resolver mídia");
  }

  const url = `https://graph.facebook.com/${WHATSAPP_API_VERSION}/${mediaId}?redirect=false`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });

  const data = await res.json();

  if (!res.ok) {
    logger.error({ mediaId, data }, "❌ Erro ao resolver URL da mídia");
    throw new Error("Erro ao resolver URL da mídia");
  }

  return {
    url: data.url,
    mimeType: data.mime_type
  };
}

/**
 * Faz download da mídia para a pasta /uploads e retorna a URL local.
 */
async function downloadToUploads(fileUrl, suggestedName, mimeTypeHint) {
  if (!fileUrl) return null;

  const res = await fetch(fileUrl, {
    // para alguns tipos o bearer é obrigatório
    headers: WHATSAPP_TOKEN
      ? { Authorization: `Bearer ${WHATSAPP_TOKEN}` }
      : {}
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error(
      { status: res.status, fileUrl, text },
      "❌ Erro ao baixar mídia do WhatsApp"
    );
    throw new Error("Erro ao baixar mídia");
  }

  const contentType =
    mimeTypeHint ||
    res.headers.get("content-type") ||
    "application/octet-stream";

  const guessedExt = (() => {
    const typePart = contentType.split(";")[0].trim(); // image/jpeg
    if (!typePart.includes("/")) return "bin";
    const ext = typePart.split("/")[1]; // jpeg
    return ext || "bin";
  })();

  const safeBase =
    suggestedName?.replace(/[^a-zA-Z0-9_.-]/g, "_") ||
    `media-${Date.now()}`;

  const fileName = safeBase.endsWith(`.${guessedExt}`)
    ? safeBase
    : `${safeBase}.${guessedExt}`;

  const filePath = path.join(UPLOADS_DIR, fileName);

  const arrayBuffer = await res.arrayBuffer();
  fs.writeFileSync(filePath, Buffer.from(arrayBuffer));

  logger.info(
    { filePath, contentType },
    "💾 Mídia baixada para uploads"
  );

  // URL que o frontend acessa (index.js já faz app.use('/uploads', ...))
  return `/uploads/${fileName}`;
}

/**
 * Normaliza QUALQUER mensagem do webhook WhatsApp em um formato
 * que o restante do backend/ frontend entende.
 *
 * Retorna SEMPRE algo do tipo:
 * {
 *   direction: "in",
 *   type: "text" | "image" | "video" | "audio" | "document" | "sticker" | "location" | "unknown",
 *   text: string,
 *   mediaUrl?: string,
 *   mimeType?: string,
 *   timestamp: ISOString,
 *   rawType: string,
 *   raw: object
 * }
 */
export async function normalizeIncomingWhatsappMessage(msg) {
  const base = {
    direction: "in",
    timestamp: new Date(Number(msg.timestamp) * 1000).toISOString(),
    rawType: msg.type,
    raw: msg
  };

  // -------------------------
  // 1) TEXTO SIMPLES
  // -------------------------
  if (msg.type === "text") {
    return {
      ...base,
      type: "text",
      text: msg.text?.body || ""
    };
  }

  // -------------------------
  // 2) MÍDIAS (image, video, audio, document, sticker)
  // -------------------------
  if (["image", "video", "audio", "document", "sticker"].includes(msg.type)) {
    const container = msg[msg.type] || {};

    // Alguns payloads vêm com "url", outros com "link", outros só com "id"
    let fileUrl = container.url || container.link || null;
    const mediaId = container.id;

    let resolvedMime = container.mime_type || container.content_type || null;

    // Se não veio URL, resolve pela Graph API usando o ID
    if (!fileUrl && mediaId) {
      try {
        const resolved = await resolveMediaUrlFromId(mediaId);
        fileUrl = resolved.url;
        resolvedMime = resolvedMime || resolved.mimeType;
      } catch (err) {
        logger.error({ mediaId, err }, "⚠️ Falha ao resolver URL da mídia");
      }
    }

    // Texto / legenda
    let caption = container.caption || "";
    if (!caption && msg.type === "document" && container.filename) {
      caption = container.filename;
    }

    // Faz download para /uploads (se possível)
    let localUrl = null;
    if (fileUrl) {
      try {
        const suggestedName =
          container.filename ||
          `${msg.type}-${mediaId || Date.now()}`;
        localUrl = await downloadToUploads(
          fileUrl,
          suggestedName,
          resolvedMime
        );
      } catch (err) {
        // fallback: mostra a URL remota mesmo
        logger.error(
          { fileUrl, err },
          "⚠️ Falha ao baixar mídia; usando URL remota"
        );
        localUrl = fileUrl;
      }
    }

    return {
      ...base,
      type: msg.type,
      text: caption,
      mediaUrl: localUrl,
      mimeType: resolvedMime
    };
  }

  // -------------------------
  // 3) LOCALIZAÇÃO
  // -------------------------
  if (msg.type === "location") {
    const loc = msg.location || {};
    const text =
      `Localização: ${loc.latitude}, ${loc.longitude}` +
      (loc.name ? ` - ${loc.name}` : "") +
      (loc.address ? ` – ${loc.address}` : "");

    return {
      ...base,
      type: "location",
      text,
      location: {
        latitude: loc.latitude,
        longitude: loc.longitude,
        name: loc.name,
        address: loc.address
      }
    };
  }

  // -------------------------
  // 4) QUALQUER OUTRO TIPO
  // -------------------------
  return {
    ...base,
    type: "unknown",
    text: `[${msg.type}]`
  };
}
