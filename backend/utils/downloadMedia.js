import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import logger from "../logger.js";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function downloadMediaFromMeta(mediaId, accessToken) {
  try {
    // 1) Buscar URL assinada da mídia
    const metadataUrl = `https://graph.facebook.com/v22.0/${mediaId}`;
    const metadataRes = await fetch(metadataUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const metadata = await metadataRes.json();
    const mediaUrl = metadata?.url;

    if (!mediaUrl) {
      throw new Error("Meta não retornou URL da mídia");
    }

    // 2) Baixar o arquivo real
    const mediaRes = await fetch(mediaUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!mediaRes.ok) {
      throw new Error(`Erro ao baixar mídia: ${mediaRes.status}`);
    }

    const buffer = await mediaRes.buffer();

    // 3) Definir nome do arquivo
    const uploadsDir = path.join(process.cwd(), "uploads");
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

    const ext = mediaRes.headers
      .get("content-type")
      ?.split("/")
      ?.pop()
      ?.replace("jpeg", "jpg") || "bin";

    const fileName = `${mediaId}.${ext}`;
    const filePath = path.join(uploadsDir, fileName);

    fs.writeFileSync(filePath, buffer);

    // 4) Retorna URL pública para o frontend
    return `/uploads/${fileName}`;
  } catch (err) {
    logger.error({ err }, "❌ Erro ao baixar mídia da Meta");
    return null;
  }
}
