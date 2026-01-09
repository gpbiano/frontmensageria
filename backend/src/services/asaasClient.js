// backend/src/services/asaasClient.js
import fetch from "node-fetch";

function env(name, def = "") {
  return String(process.env[name] || def).trim();
}

const ASAAS_API_KEY = env("ASAAS_API_KEY");
const ASAAS_ENV = env("ASAAS_ENV", "sandbox"); // sandbox | prod

function baseUrl() {
  // ✅ sandbox usa domínio diferente no Asaas
  // produção: https://api.asaas.com
  // sandbox:  https://api-sandbox.asaas.com
  return ASAAS_ENV === "prod" ? "https://api.asaas.com" : "https://api-sandbox.asaas.com";
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

// -------------------------------
// Customers
// -------------------------------
export async function asaasCreateCustomer(payload) {
  const body = { ...payload };
  if (body.cpfCnpj) body.cpfCnpj = normalizeDigits(body.cpfCnpj);
  if (body.postalCode) body.postalCode = normalizeDigits(body.postalCode);
  return asaasRequest("/v3/customers", { method: "POST", body });
}

export async function asaasGetCustomer(customerId) {
  return asaasRequest(`/v3/customers/${encodeURIComponent(customerId)}`);
}

// -------------------------------
// Subscriptions (Assinaturas)
// -------------------------------
export async function asaasCreateSubscription(payload) {
  // payload esperado (exemplo):
  // {
  //   customer: "cus_...",
  //   billingType: "BOLETO" | "CREDIT_CARD" | "PIX" | "UNDEFINED",
  //   cycle: "MONTHLY" | "QUARTERLY" | "YEARLY",
  //   value: 99.9,
  //   nextDueDate: "2026-01-10",
  //   description?: "Plano ...",
  //   externalReference?: "tenant:<id>",
  // }
  const body = { ...payload };
  return asaasRequest("/v3/subscriptions", { method: "POST", body });
}

export async function asaasGetSubscription(subscriptionId) {
  return asaasRequest(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export const asaasConfig = {
  env: ASAAS_ENV,
  baseUrl: baseUrl()
};
