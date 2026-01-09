// backend/src/services/asaasClient.js
import fetchLib from "node-fetch";

function env(name, def = "") {
  return String(process.env[name] || def).trim();
}

const ASAAS_API_KEY = env("ASAAS_API_KEY");
const ASAAS_ENV = env("ASAAS_ENV", "sandbox"); // sandbox | prod (informativo)
const ASAAS_BASE_URL = env("ASAAS_BASE_URL", "https://api.asaas.com"); // pode sobrescrever se quiser

function getFetch() {
  // Node 18+ tem fetch global; senão usa node-fetch
  return globalThis.fetch ? globalThis.fetch.bind(globalThis) : fetchLib;
}

function baseUrl() {
  return ASAAS_BASE_URL.replace(/\/+$/, "");
}

function assertConfigured() {
  if (!ASAAS_API_KEY) {
    const err = new Error("ASAAS_API_KEY não configurada");
    err.code = "ASAAS_NOT_CONFIGURED";
    throw err;
  }
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function extractAsaasError(json) {
  // Asaas costuma retornar { errors: [{ description }] } ou { message }
  const first = Array.isArray(json?.errors) ? json.errors[0] : null;
  return (
    first?.description ||
    json?.message ||
    json?.error ||
    json?.errors?.description ||
    "unknown"
  );
}

async function asaasRequest(path, { method = "GET", body } = {}) {
  assertConfigured();

  const url = `${baseUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
    "User-Agent": "gplabs-billing/1.0"
  };

  const fetch = getFetch();
  const resp = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`Asaas error ${resp.status}: ${extractAsaasError(json)}`);
    err.status = resp.status;
    err.payload = json;
    err.code = "ASAAS_HTTP_ERROR";
    throw err;
  }

  return json;
}

// ===============================
// Customers
// ===============================

export async function asaasCreateCustomer(payload) {
  // payload esperado (exemplo):
  // { name, cpfCnpj, email?, mobilePhone?, postalCode?, address?, addressNumber?, complement?, province?, city?, state? }
  const body = { ...(payload || {}) };

  if (body.cpfCnpj) body.cpfCnpj = normalizeDigits(body.cpfCnpj);
  if (body.postalCode) body.postalCode = normalizeDigits(body.postalCode);

  return asaasRequest("/v3/customers", { method: "POST", body });
}

export async function asaasGetCustomer(customerId) {
  return asaasRequest(`/v3/customers/${encodeURIComponent(String(customerId))}`);
}

export async function asaasListCustomers(params = {}) {
  // exemplos de params úteis:
  // { cpfCnpj, email, name, offset, limit }
  const q = new URLSearchParams();

  if (params.cpfCnpj) q.set("cpfCnpj", normalizeDigits(params.cpfCnpj));
  if (params.email) q.set("email", String(params.email).trim());
  if (params.name) q.set("name", String(params.name).trim());
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.limit != null) q.set("limit", String(params.limit));

  const qs = q.toString();
  const path = qs ? `/v3/customers?${qs}` : "/v3/customers";
  return asaasRequest(path);
}

/**
 * ✅ Evita duplicar cliente no Asaas:
 * - procura por cpfCnpj
 * - se achar, retorna o primeiro
 * - se não achar, cria
 */
export async function asaasUpsertCustomerByCpfCnpj(payload) {
  const cpfCnpj = normalizeDigits(payload?.cpfCnpj);
  if (!cpfCnpj) {
    const err = new Error("cpfCnpj obrigatório para upsert no Asaas");
    err.code = "ASAAS_INVALID_INPUT";
    throw err;
  }

  const list = await asaasListCustomers({ cpfCnpj, limit: 10, offset: 0 });
  const data = Array.isArray(list?.data) ? list.data : [];

  if (data.length > 0) {
    return {
      ok: true,
      mode: "existing",
      customer: data[0]
    };
  }

  const created = await asaasCreateCustomer({ ...payload, cpfCnpj });
  return {
    ok: true,
    mode: "created",
    customer: created
  };
}

// ===============================
// Utils
// ===============================

export async function asaasPing() {
  // endpoint simples só pra validar credencial
  // (qualquer request ok já confirma a chave)
  return asaasRequest("/v3/myAccount");
}

export const asaasConfig = {
  env: ASAAS_ENV,
  baseUrl: ASAAS_BASE_URL
};
