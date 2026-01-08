// backend/src/services/asaasClient.js
import fetch from "node-fetch";

function env(name, def = "") {
  return String(process.env[name] || def).trim();
}

const ASAAS_API_KEY = env("ASAAS_API_KEY");
const ASAAS_ENV = env("ASAAS_ENV", "sandbox"); // sandbox | prod

function baseUrl() {
  // Asaas usa o mesmo endpoint, mas alguns times separam por env internamente.
  // Mantemos 1 base e controlamos por chave.
  // Se você tiver URL diferente no seu setup, basta trocar aqui.
  return "https://api.asaas.com";
}

function assertConfigured() {
  if (!ASAAS_API_KEY) {
    const err = new Error("ASAAS_API_KEY não configurada");
    err.code = "ASAAS_NOT_CONFIGURED";
    throw err;
  }
}

async function asaasRequest(path, { method = "GET", body } = {}) {
  assertConfigured();

  const url = `${baseUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    access_token: ASAAS_API_KEY,
    "User-Agent": "gplabs-billing/1.0"
  };

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
    const err = new Error(
      `Asaas error ${resp.status}: ${json?.errors?.[0]?.description || json?.message || "unknown"}`
    );
    err.status = resp.status;
    err.payload = json;
    throw err;
  }

  return json;
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

export async function asaasCreateCustomer(payload) {
  // payload esperado (exemplo):
  // { name, cpfCnpj, email?, mobilePhone?, postalCode, address, addressNumber, complement?, province?, city?, state? }
  const body = { ...payload };

  if (body.cpfCnpj) body.cpfCnpj = normalizeDigits(body.cpfCnpj);
  if (body.postalCode) body.postalCode = normalizeDigits(body.postalCode);

  return asaasRequest("/v3/customers", { method: "POST", body });
}

export async function asaasGetCustomer(customerId) {
  return asaasRequest(`/v3/customers/${encodeURIComponent(customerId)}`);
}

export const asaasConfig = {
  env: ASAAS_ENV
};
