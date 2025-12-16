import jwt from "jsonwebtoken";
import logger from "../logger.js";

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("❌ JWT_SECRET não definido no ambiente");
}

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, email, role }
    return next();
  } catch (err) {
    logger.warn({ err: err.message }, "⚠️ Token inválido");
    return res.status(401).json({ error: "Token inválido ou expirado." });
  }
}

export function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!allowed.length) return next();

    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: "Sem permissão." });
    }

    return next();
  };
}
