import jwt from "jsonwebtoken";
import logger from "../logger.js";

/**
 * Autentica o usuário via JWT
 * - Injeta req.user
 * - NÃO exige tenant (isso fica para requireTenant)
 */
export function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      logger.error("❌ JWT_SECRET não definido no ambiente.");
      return res.status(500).json({ error: "Configuração inválida." });
    }

    const payload = jwt.verify(token, secret);
    req.user = payload; 
    // payload esperado:
    // { id, tenantId?, role, name, email }

    return next();
  } catch (err) {
    logger.warn({ err }, "⚠️ Token inválido");
    return res.status(401).json({ error: "Token inválido." });
  }
}

/**
 * Garante que o tenant do token bate com o tenant resolvido na request
 * Usar APENAS em rotas multi-tenant (painel)
 */
export function enforceTokenTenant(req, res, next) {
  const tokenTenantId = req.user?.tenantId || null;
  const reqTenantId = req.tenant?.id || null;

  // Se a rota não tem tenant (health, webhook, master), não bloqueia
  if (!reqTenantId) return next();

  // Token sem tenant tentando acessar rota de tenant
  if (!tokenTenantId) {
    return res.status(403).json({ error: "Token sem contexto de tenant." });
  }

  // Token de um tenant tentando acessar outro
  if (tokenTenantId !== reqTenantId) {
    logger.warn(
      {
        tokenTenantId,
        reqTenantId,
        userId: req.user?.id,
      },
      "🚫 Tentativa de acesso entre tenants bloqueada"
    );
    return res.status(403).json({ error: "Acesso negado (tenant mismatch)." });
  }

  return next();
}

/**
 * Controle de papéis (roles)
 */
export function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    const role = req.user?.role;

    // se não passou roles, não restringe
    if (!allowed.length) return next();

    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: "Sem permissão." });
    }

    return next();
  };
}
