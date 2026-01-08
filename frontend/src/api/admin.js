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

// ===============================
// Admin Tenants
// ===============================
export function listTenants({ page = 1, pageSize = 25, q = "" } = {}) {
  return http.get("/admin/tenants", { params: { page, pageSize, q } });
}

export function fetchTenant(id) {
  return http.get(`/admin/tenants/${id}`);
}

export function createTenant(payload) {
  return http.post("/admin/tenants", payload);
}

export function updateTenant(id, payload) {
  return http.patch(`/admin/tenants/${id}`, payload);
}

export function deleteTenant(id) {
  return http.delete(`/admin/tenants/${id}`);
}

// Billing
export function updateTenantBilling(id, payload) {
  return http.patch(`/admin/tenants/${id}/billing`, payload);
}

export function bootstrapTenant(id, payload) {
  return http.post(`/admin/tenants/${id}/bootstrap`, payload || {});
}

export function syncTenantBilling(id) {
  return http.post(`/admin/tenants/${id}/billing/sync`, {});
}
