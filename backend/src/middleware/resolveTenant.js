// backend/src/middlewares/resolveTenant.js
import { prisma } from "../lib/prisma.js";

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split("/")[0]
    .split(":")[0];
}

function safeGetOriginHost(req) {
  const origin = req.headers.origin;
  if (origin) return normalizeHost(origin);

  const ref = req.headers.referer;
  if (ref) return normalizeHost(ref);

  const host = req.headers.host;
  if (host) return normalizeHost(host);

  return "";
}

export function resolveTenant({
  tenantBaseDomain = "cliente.gplabs.com.br",
  allowNoTenantPaths = []
} = {}) {
  const base = normalizeHost(tenantBaseDomain);

  return async function resolveTenantMiddleware(req, res, next) {
    try {
      // paths liberados (health/webhook/login etc.)
      if (allowNoTenantPaths.includes(req.path)) {
        return next();
      }

      // 1) header direto (fallback dev)
      const headerTenant =
        String(req.headers["x-tenant-id"] || "").trim() ||
        String(req.headers["x-tenant"] || "").trim();

      // 2) por origin/referer/host -> subdomínio
      const host = safeGetOriginHost(req);

      let slug = null;

      // Se vier host tipo empresa.cliente.gplabs.com.br
      if (host && base && host.endsWith("." + base)) {
        slug = host.replace("." + base, "");
      }

      // Se não achou slug pelo host, aceita body/query (fallback dev)
      if (!slug) {
        slug =
          String(req.tenantSlug || "").trim() ||
          String(req.body?.tenantSlug || "").trim() ||
          String(req.query?.tenantSlug || "").trim() ||
          null;
      }

      // Se veio tenantId direto no header, resolve por ID
      if (headerTenant) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: headerTenant },
          select: { id: true, slug: true, isActive: true }
        });

        if (tenant && tenant.isActive) {
          req.tenant = tenant;
          req.tenantSlug = tenant.slug;
        }

        return next();
      }

      // Sem slug → segue (requireTenant decide se bloqueia)
      if (!slug) return next();

      req.tenantSlug = slug;

      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, isActive: true }
      });

      if (tenant && tenant.isActive) {
        req.tenant = tenant;
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
