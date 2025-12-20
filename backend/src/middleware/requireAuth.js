//backend/src/middlewares/requireTenant.js
import jwt from "jsonwebtoken";
import logger from "../logger.js";

export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("❌ JWT_SECRET não definido no ambiente.");
      return res.status(500).json({ error: "Configuração inválida." });
    }

    const payload = jwt.verify(token, secret);
    req.user = payload;

    return next();
  } catch (err) {
    logger.warn({ err }, "⚠️ Token inválido");
    return res.status(401).json({ error: "Token inválido." });
  }
}

/**
 * ✅ trava o tenant do token vs tenant resolvido pelo resolveTenant
 * - se não tiver tenant no token, bloqueia
 * - se tiver tenant resolvido e for diferente, bloqueia
 */
export function enforceTokenTenant(req, res, next) {
  const tokenTenantId = req.user?.tenantId || null;

  if (!tokenTenantId) {
    return res.status(401).json({ error: "Token sem tenantId." });
  }

  // se já resolveu tenant pelo host/header, valida
  if (req.tenant?.id && req.tenant.id !== tokenTenantId) {
    return res.status(403).json({ error: "Tenant do token não confere com o tenant atual." });
  }

  return next();
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
