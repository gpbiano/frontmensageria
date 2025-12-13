import jwt from "jsonwebtoken";
import logger from "../logger.js";

const JWT_SECRET = process.env.JWT_SECRET || "gplabs-dev-secret";

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, ... }
    return next();
  } catch (err) {
    logger.warn({ err }, "⚠️ Token inválido");
    return res.status(401).json({ error: "Token inválido." });
  }
}

export function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    const role = req.user?.role;
    if (!allowed.length) return next();
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: "Sem permissão." });
    }
    return next();
  };
}
