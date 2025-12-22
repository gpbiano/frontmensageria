// backend/src/middleware/requireTenant.js
// (ou backend/src/middlewares/requireTenant.js — use o path que seu index.js importa)

function isAllowedPath(reqPath, allowNoTenantPaths = []) {
  const p = String(reqPath || "/");
  return allowNoTenantPaths.some((base) => {
    const b = String(base || "").trim();
    if (!b) return false;
    if (p === b) return true;
    return p.startsWith(b.endsWith("/") ? b : b + "/");
  });
}

export function requireTenant(options = {}) {
  const {
    allowNoTenantPaths = [
      "/",
      "/health",
      "/login",
      "/auth",
      "/webhook/whatsapp",
      "/webchat"
    ]
  } = options;

  return function requireTenantMiddleware(req, res, next) {
    // ✅ não exige tenant em rotas públicas (e sub-rotas)
    if (isAllowedPath(req.path, allowNoTenantPaths)) return next();

    // ✅ prioridade 1: tenant resolvido pelo resolveTenant
    if (req.tenant?.id) {
      req.tenantId = String(req.tenant.id);
      req.tenantSlug = String(req.tenant.slug || req.tenantSlug || "");
      return next();
    }

    // ✅ prioridade 2: tenant vindo do token (quando seu auth já inclui tenantId)
    if (req.user?.tenantId) {
      req.tenantId = String(req.user.tenantId);
      if (req.user?.tenantSlug) req.tenantSlug = String(req.user.tenantSlug);
      return next();
    }

    return res.status(400).json({
      error: "Tenant não resolvido.",
      hint:
        "Acesse via subdomínio (empresa.cliente.gplabs.com.br) OU envie o header X-Tenant-Id (aceita id ou slug) / X-Tenant."
    });
  };
}
