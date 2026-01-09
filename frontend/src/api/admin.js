// frontend/src/api/admin.js
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

// ✅ opcional: força o base do admin sem heurística
// Ex: VITE_ADMIN_BASE_PATH=/admin/tenants  OU  /admin/cadastros
const FORCED_ADMIN_BASE_PATH = String(import.meta.env.VITE_ADMIN_BASE_PATH || "").trim();

const AUTH_TOKEN_KEY = "gpLabsAuthToken";

function getToken() {
  try {
    return (
      localStorage.getItem(AUTH_TOKEN_KEY) ||
      sessionStorage.getItem(AUTH_TOKEN_KEY) ||
      window.__GP_AUTH_TOKEN__ ||
      ""
    );
  } catch {
    return "";
  }
}

const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: 30000
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// =====================================
// Base path do Admin
// =====================================
let _adminBasePath = null;

/**
 * Resolve base path do Admin:
 * 1) Se VITE_ADMIN_BASE_PATH estiver setado, usa ele e pronto.
 * 2) Caso contrário:
 *    - tenta /admin/cadastros
 *    - depois /admin/tenants
 *
 * Observação:
 * - Se der 403/401, significa que o endpoint existe mas não autorizou.
 *   Então consideramos como existente e usamos mesmo assim.
 */
async function resolveAdminBasePath() {
  if (_adminBasePath) return _adminBasePath;

  if (FORCED_ADMIN_BASE_PATH) {
    _adminBasePath = FORCED_ADMIN_BASE_PATH.startsWith("/")
      ? FORCED_ADMIN_BASE_PATH
      : `/${FORCED_ADMIN_BASE_PATH}`;
    return _adminBasePath;
  }

  // ✅ tenta cadastros primeiro (novo)
  try {
    await http.get("/admin/cadastros", { params: { page: 1, pageSize: 1, q: "" } });
    _adminBasePath = "/admin/cadastros";
    return _adminBasePath;
  } catch (e) {
    const status = e?.response?.status;
    // se não for 404, endpoint existe (pode ser 401/403)
    if (status && status !== 404) {
      _adminBasePath = "/admin/cadastros";
      return _adminBasePath;
    }
  }

  // ✅ fallback tenants (legado / alternativo)
  try {
    await http.get("/admin/tenants", { params: { page: 1, pageSize: 1, q: "" } });
    _adminBasePath = "/admin/tenants";
    return _adminBasePath;
  } catch (e2) {
    const status2 = e2?.response?.status;
    if (status2 && status2 !== 404) {
      _adminBasePath = "/admin/tenants";
      return _adminBasePath;
    }
  }

  // último fallback
  _adminBasePath = "/admin/tenants";
  return _adminBasePath;
}

async function adminGet(path, config) {
  const base = await resolveAdminBasePath();
  return http.get(`${base}${path}`, config);
}

async function adminPost(path, data, config) {
  const base = await resolveAdminBasePath();
  return http.post(`${base}${path}`, data, config);
}

async function adminPatch(path, data, config) {
  const base = await resolveAdminBasePath();
  return http.patch(`${base}${path}`, data, config);
}

async function adminDelete(path, config) {
  const base = await resolveAdminBasePath();
  return http.delete(`${base}${path}`, config);
}

// =====================================
// EXPORTS PRINCIPAIS
// =====================================
export function fetchTenantsAdmin({ page = 1, pageSize = 25, q = "" } = {}) {
  return adminGet("", { params: { page, pageSize, q } });
}

export function fetchTenantAdmin(id) {
  if (!id) throw new Error("fetchTenantAdmin: id é obrigatório");
  return adminGet(`/${encodeURIComponent(String(id))}`);
}

export function createTenantAdmin(payload) {
  return adminPost("", payload);
}

export function updateTenantAdmin(id, payload) {
  if (!id) throw new Error("updateTenantAdmin: id é obrigatório");
  return adminPatch(`/${encodeURIComponent(String(id))}`, payload);
}

export function deleteTenantAdmin(id) {
  if (!id) throw new Error("deleteTenantAdmin: id é obrigatório");
  return adminDelete(`/${encodeURIComponent(String(id))}`);
}

// Billing
export function updateTenantBillingAdmin(id, payload) {
  if (!id) throw new Error("updateTenantBillingAdmin: id é obrigatório");
  return adminPatch(`/${encodeURIComponent(String(id))}/billing`, payload);
}

export function bootstrapTenantAdmin(id, payload) {
  if (!id) throw new Error("bootstrapTenantAdmin: id é obrigatório");
  return adminPost(`/${encodeURIComponent(String(id))}/bootstrap`, payload || {});
}

/**
 * 🚨 IMPORTANTE:
 * Este endpoint precisa existir no backend:
 * POST /admin/(cadastros|tenants)/:id/billing/sync
 *
 * Se não existir, você SEMPRE verá 404 no console (igual você mostrou).
 */
export function syncTenantBillingAdmin(id) {
  if (!id) throw new Error("syncTenantBillingAdmin: id é obrigatório");
  return adminPost(`/${encodeURIComponent(String(id))}/billing/sync`, {});
}

// =====================================
// COMPAT (nomes antigos)
// =====================================
export function listTenants(opts) {
  return fetchTenantsAdmin(opts);
}
export function fetchTenant(id) {
  return fetchTenantAdmin(id);
}
export function createTenant(payload) {
  return createTenantAdmin(payload);
}
export function updateTenant(id, payload) {
  return updateTenantAdmin(id, payload);
}
export function deleteTenant(id) {
  return deleteTenantAdmin(id);
}
export function updateTenantBilling(id, payload) {
  return updateTenantBillingAdmin(id, payload);
}
export function bootstrapTenant(id, payload) {
  return bootstrapTenantAdmin(id, payload);
}
export function syncTenantBilling(id) {
  return syncTenantBillingAdmin(id);
}
