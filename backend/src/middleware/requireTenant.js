export function requireTenant(req, res, next) {
  if (!req.tenant?.id) {
    return res.status(400).json({ error: "missing_tenant_context" });
  }
  req.tenantId = req.tenant.id;
  return next();
}
