// backend/src/middlewares/requireTenant.js
export function requireTenant(req, res, next) {
  if (req.tenant?.id) return next();

  return res.status(400).json({
    error: "Tenant não resolvido.",
    hint:
      "Verifique se está acessando via subdomínio (empresa.cliente.gplabs.com.br) ou envie X-Tenant-Id."
  });
}
