// frontend/src/api/admin.js
import axios from "axios";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const client = axios.create({
  baseURL: `${API_BASE}/admin`
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem("gpLabsAuthToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// -------- TENANTS --------
export const fetchTenants = (params) => client.get("/tenants", { params });

export const fetchTenant = (id) => client.get(`/tenants/${id}`);

export const createTenant = (data) => client.post("/tenants", data);

export const updateTenant = (id, data) => client.patch(`/tenants/${id}`, data);

export const updateTenantBilling = (id, data) =>
  client.patch(`/tenants/${id}/billing`, data);

export const bootstrapTenant = (id, body = {}) =>
  client.post(`/tenants/${id}/bootstrap`, body);

export const syncTenantBilling = (id) =>
  client.post(`/tenants/${id}/billing/sync`);

