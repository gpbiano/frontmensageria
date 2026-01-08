// frontend/src/api/admin.js
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

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
  withCredentials: true
});

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/**
 * Resolve base path do Admin:
 * - prefere /admin/cadastros (novo)
 * - fallback /admin/tenants (legado)
 */
let _adminBasePath = null;

async function resolveAdminBasePath() {
  if (_adminBasePath) return _adminBasePath;

  // tenta novo primeiro
  try {
    await http.get("/admin/cadastros", { params: { page: 1, pageSize: 1, q: "" } });
    _adminBasePath = "/admin/cadastros";
    return _adminBasePath;
  } catch (e) {
    const status = e?.response?.status;
    // se não for 404, assume novo (pode ser 403 etc.)
    if (status && status !== 404) {
      _adminBasePath = "/admin/cadastros";
      return _adminBasePath;
    }
  }

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
// ✅ EXPORTS PRINCIPAIS (os que o front importa)
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

export function syncTenantBillingAdmin(id) {
  if (!id) throw new Error("syncTenantBillingAdmin: id é obrigatório");
  return adminPost(`/${encodeURIComponent(String(id))}/billing/sync`, {});
}

// =====================================
// ✅ COMPAT (se algum arquivo antigo ainda usa esses nomes)
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
