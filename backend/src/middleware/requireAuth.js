// backend/src/middleware/requireAuth.js
import jwt from "jsonwebtoken";
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || "").trim();
  if (!secret) throw new Error("JWT_SECRET não definido");
  return secret;
}

function readBearer(req) {
  const h = String(req.headers.authorization || "").trim();
  if (!h.toLowerCase().startsWith("bearer ")) return "";
  return h.slice(7).trim();
}

export function requireAuth(req, res, next) {
  try {
    const token = readBearer(req);
    if (!token) return res.status(401).json({ error: "Não autenticado." });

    const decoded = jwt.verify(token, getJwtSecret());
    if (!decoded?.id) return res.status(401).json({ error: "Token inválido." });

    req.user = {
      id: String(decoded.id),
      email: decoded.email ? String(decoded.email) : null,
      role: decoded.role ? String(decoded.role) : null,
      tenantId: decoded.tenantId ? String(decoded.tenantId) : null,
      tenantSlug: decoded.tenantSlug ? String(decoded.tenantSlug) : null
    };

    return next();
  } catch (err) {
    logger.warn({ err }, "🔒 requireAuth: token inválido");
    return res.status(401).json({ error: "Token inválido." });
  }
}

/**
 * ✅ FIX DEFINITIVO:
 * - se resolveTenant não achou tenant via host/header
 * - mas o token tem tenantId
 * => buscamos no banco e setamos req.tenant
 */
export async function enforceTokenTenant(req, res, next) {
  try {
    // já resolvido por resolveTenant (host/header)
    if (req.tenant?.id) return next();

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "tenant_not_resolved" });
    }

    const tenant = await prisma.tenant.findUnique({
      where: { id: String(tenantId) },
      select: { id: true, slug: true, isActive: true }
    });

    if (!tenant || tenant.isActive === false) {
      return res.status(400).json({ error: "tenant_not_resolved" });
    }

    req.tenant = tenant;
    req.tenantSlug = tenant.slug;

    return next();
  } catch (err) {
    logger.error({ err }, "❌ enforceTokenTenant error");
    return res.status(500).json({ error: "internal_error" });
  }
}

/**
 * ✅ requireRole(...)
 * Uso: requireRole("admin") ou requireRole("admin", "manager")
 * - lê role de req.user.role (setado no requireAuth)
 * - se role não existir => 401
 * - se não estiver permitido => 403
 */
export function requireRole(...allowed) {
  const allowedSet = new Set(
    allowed
      .flat()
      .filter(Boolean)
      .map((r) => String(r).toLowerCase())
  );

  return function requireRoleMiddleware(req, res, next) {
    const role = String(req.user?.role || "").toLowerCase();

    if (!role) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    // fail-safe: se não passar roles, não bloqueia
    if (allowedSet.size === 0) return next();

    if (!allowedSet.has(role)) {
      return res.status(403).json({
        error: "Sem permissão.",
        required: Array.from(allowedSet),
        current: role
      });
    }

    return next();
  };
}
