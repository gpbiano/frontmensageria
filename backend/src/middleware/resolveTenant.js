// backend/src/middleware/resolveTenant.js
// (ou backend/src/middlewares/resolveTenant.js — use o path que seu index.js importa)

import prismaMod from "../lib/prisma.js";

// Prisma compat (default / prisma / direto)
const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

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

// ✅ match por prefixo (resolve problema de /auth/password/*)
function isAllowedPath(reqPath, allowNoTenantPaths = []) {
  const p = String(reqPath || "/");
  return allowNoTenantPaths.some((base) => {
    const b = String(base || "").trim();
    if (!b) return false;
    if (p === b) return true;
    // garante que "/auth/password" libera "/auth/password/verify"
    return p.startsWith(b.endsWith("/") ? b : b + "/");
  });
}

// ✅ tenta resolver header como ID e, se falhar, como SLUG
async function resolveTenantByHeaderValue(value) {
  const v = String(value || "").trim();
  if (!v) return null;

  // 1) tenta como id
  const byId = await prisma.tenant.findUnique({
    where: { id: v },
    select: { id: true, slug: true, isActive: true }
  });

  if (byId && byId.isActive) return byId;

  // 2) tenta como slug
  const bySlug = await prisma.tenant.findUnique({
    where: { slug: v },
    select: { id: true, slug: true, isActive: true }
  });

  if (bySlug && bySlug.isActive) return bySlug;

  return null;
}

export function resolveTenant({
  tenantBaseDomain = "cliente.gplabs.com.br",
  allowNoTenantPaths = []
} = {}) {
  const base = normalizeHost(tenantBaseDomain);

  return async function resolveTenantMiddleware(req, res, next) {
    try {
      // ✅ libera rotas públicas e sub-rotas
      if (isAllowedPath(req.path, allowNoTenantPaths)) return next();

      // ✅ header direto (id OU slug)
      const headerTenant =
        String(req.headers["x-tenant-id"] || "").trim() ||
        String(req.headers["x-tenant"] || "").trim();

      if (headerTenant) {
        const tenant = await resolveTenantByHeaderValue(headerTenant);

        if (tenant) {
          req.tenant = tenant;
          req.tenantId = String(tenant.id);
          req.tenantSlug = String(tenant.slug);
        }

        // sempre segue (requireTenant decide bloquear)
        return next();
      }

      // ✅ por origin/referer/host -> subdomínio
      const host = safeGetOriginHost(req);

      let slug = null;

      // host tipo: empresa.cliente.gplabs.com.br
      if (host && base && host.endsWith("." + base)) {
        slug = host.slice(0, -(("." + base).length)); // remove ".cliente.gplabs.com.br"
      }

      // fallback dev (body/query/req)
      if (!slug) {
        slug =
          String(req.tenantSlug || "").trim() ||
          String(req.body?.tenantSlug || "").trim() ||
          String(req.query?.tenantSlug || "").trim() ||
          null;
      }

      // Sem slug → segue (requireTenant decide bloquear)
      if (!slug) return next();

      req.tenantSlug = slug;

      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, isActive: true }
      });

      if (tenant && tenant.isActive) {
        req.tenant = tenant;
        req.tenantId = String(tenant.id);
        req.tenantSlug = String(tenant.slug);
      }

      return next();
    } catch (err) {
      return next(err);
    }
  };
}
