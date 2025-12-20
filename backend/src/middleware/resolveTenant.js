import { prisma } from "../lib/prisma.js";

function normalizeHost(host) {
  return String(host || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

/**
 * Extrai slug do tenant do FRONT (Origin/Referer) ou do host forwarded.
 * Ex: acme.cliente.gplabs.com.br -> "acme"
 */
function extractTenantSlugFromHost(host, baseDomain) {
  const h = normalizeHost(host);
  if (!h) return null;

  // Se baseDomain = "cliente.gplabs.com.br"
  // Queremos: "<slug>.cliente.gplabs.com.br"
  if (!h.endsWith(baseDomain)) return null;

  const prefix = h.slice(0, -baseDomain.length); // ex: "acme."
  const slug = prefix.replace(/\.$/, ""); // remove ponto final

  // slug vazio => host é o próprio baseDomain (sem tenant)
  if (!slug) return null;

  // Se tiver múltiplos níveis (ex: a.b.cliente...), pega o primeiro
  // mas normalmente será só "acme"
  return slug.split(".")[0] || null;
}

/**
 * Resolve tenant:
 * 1) Subdomínio do FRONT via Origin (browser) -> ideal
 * 2) X-Tenant-Id header (fallback p/ dev/curl)
 * 3) X-Forwarded-Host/Host (se API receber host do tenant em proxy)
 */
export function resolveTenant(options = {}) {
  const {
    tenantBaseDomain = process.env.TENANT_BASE_DOMAIN || "cliente.gplabs.com.br",
    headerName = "x-tenant-id",
    allowNoTenantPaths = ["/", "/health"],
  } = options;

  return async (req, res, next) => {
    try {
      // rotas que podem viver sem tenant
      if (allowNoTenantPaths.includes(req.path)) {
        return next();
      }

      const origin = req.headers.origin || "";
      const referer = req.headers.referer || "";
      const forwardedHost = req.headers["x-forwarded-host"] || "";
      const host = req.headers.host || "";

      let slug =
        extractTenantSlugFromHost(origin, tenantBaseDomain) ||
        extractTenantSlugFromHost(referer, tenantBaseDomain) ||
        null;

      // fallback por header (dev/curl)
      if (!slug) {
        slug = String(req.headers[headerName] || "").trim() || null;
      }

      // fallback por host forwarded/host
      if (!slug) {
        slug =
          extractTenantSlugFromHost(forwardedHost, tenantBaseDomain) ||
          extractTenantSlugFromHost(host, tenantBaseDomain) ||
          null;
      }

      // Se ainda não tiver slug: pode ser login pela master (sem subdomínio)
      req.tenant = null;
      req.tenantSlug = slug;

      if (!slug) return next(); // deixa o requireTenant decidir

      const tenant = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true, slug: true, name: true, isActive: true },
      });

      if (!tenant || !tenant.isActive) {
        return res.status(404).json({ error: "tenant_not_found_or_inactive" });
      }

      req.tenant = { id: tenant.id, slug: tenant.slug, name: tenant.name };
      return next();
    } catch (e) {
      return next(e);
    }
  };
}
