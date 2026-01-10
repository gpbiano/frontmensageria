// backend/src/services/asaasClient.js
import fetch from "node-fetch";

/**
 * IMPORTANTE (teu bug atual):
 * - Antes você lia ASAAS_API_KEY uma única vez no topo do módulo.
 * - Se o dotenv/PM2 carrega env depois (ou se o process é reiniciado sem update-env),
 *   o valor fica "" pra sempre e dá "ASAAS_API_KEY não configurada".
 *
 * Correção:
 * - Lemos ENV SEMPRE “on-demand” dentro de getters, garantindo valor atual do process.env.
 * - Também normalizamos ASAAS_ENV para aceitar "prod" e "production".
 */

function env(name, def = "") {
  return String(process.env[name] ?? def).trim();
}

function getAsaasEnv() {
  const v = env("ASAAS_ENV", "sandbox").toLowerCase();
  // aceita variações
  if (v === "prod" || v === "production") return "prod";
  return "sandbox";
}

function getAsaasApiKey() {
  // não cacheia. sempre pega o valor atual do process.env
  return env("ASAAS_API_KEY", "");
}

function baseUrl() {
  // produção: https://api.asaas.com
  // sandbox:  https://api-sandbox.asaas.com
  return getAsaasEnv() === "prod" ? "https://api.asaas.com" : "https://api-sandbox.asaas.com";
}

function assertConfigured() {
  const key = getAsaasApiKey();
  if (!key) {
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
    // ✅ Asaas usa header "access_token"
    access_token: getAsaasApiKey(),
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
    // tenta extrair mensagem padrão Asaas
    const description =
      json?.errors?.[0]?.description ||
      json?.errors?.[0]?.message ||
      json?.message ||
      "unknown";

    const err = new Error(`Asaas error ${resp.status}: ${description}`);
    err.status = resp.status;
    err.payload = json;
    err.asaas = {
      env: getAsaasEnv(),
      baseUrl: baseUrl(),
      path,
      method
    };
    throw err;
  }

  return json;
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

// -------------------------------
// Customers
// -------------------------------
export async function asaasCreateCustomer(payload) {
  const body = { ...(payload || {}) };
  if (body.cpfCnpj) body.cpfCnpj = normalizeDigits(body.cpfCnpj);
  if (body.postalCode) body.postalCode = normalizeDigits(body.postalCode);
  return asaasRequest("/v3/customers", { method: "POST", body });
}

export async function asaasGetCustomer(customerId) {
  return asaasRequest(`/v3/customers/${encodeURIComponent(String(customerId || ""))}`);
}

// -------------------------------
// Subscriptions (Assinaturas)
// -------------------------------
export async function asaasCreateSubscription(payload) {
  const body = { ...(payload || {}) };
  return asaasRequest("/v3/subscriptions", { method: "POST", body });
}

export async function asaasGetSubscription(subscriptionId) {
  return asaasRequest(`/v3/subscriptions/${encodeURIComponent(String(subscriptionId || ""))}`);
}

// ✅ export “dinâmico” (reflete o env atual)
export const asaasConfig = {
  get env() {
    return getAsaasEnv();
  },
  get baseUrl() {
    return baseUrl();
  }
};
