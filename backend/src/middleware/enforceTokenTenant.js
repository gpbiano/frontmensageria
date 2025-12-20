/**
 * Trava o tenant do token com o tenant resolvido do request.
 * - Se a rota tiver req.tenant, token precisa bater.
 * - Se a rota não tiver tenant (ex: master), não bloqueia.
 */
export function enforceTokenTenant(req, res, next) {
  const tokenTenantId = req.user?.tenantId || null;
  const reqTenantId = req.tenant?.id || null;

  if (reqTenantId && tokenTenantId && reqTenantId !== tokenTenantId) {
    return res.status(403).json({ error: "tenant_mismatch" });
  }
  return next();
}
