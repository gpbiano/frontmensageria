import jwt from "jsonwebtoken";
import logger from "../logger.js";

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    // DEBUG TEMP (remove depois)
    logger.info(
      {
        hasAuth: !!auth,
        authPrefix: auth.slice(0, 12),
        tokenLen: token.length,
        tokenStart: token.slice(0, 12),
        jwtSecretLen: (process.env.JWT_SECRET || "").length
      },
      "🔎 AUTH DEBUG"
    );

    if (!token) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    if (!process.env.JWT_SECRET) {
      logger.error("❌ JWT_SECRET não definido no ambiente.");
      return res.status(500).json({ error: "Configuração inválida." });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;

    return next();
  } catch (err) {
    logger.warn({ err }, "⚠️ Token inválido");
    return res.status(401).json({ error: "Token inválido." });
  }
}
