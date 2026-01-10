import fetch from "node-fetch";

function env(name, def = "") {
  return String(process.env[name] ?? def).trim();
}

function getAsaasEnv() {
  // aceita: "prod", "production", "live"
  const v = env("ASAAS_ENV", "sandbox").toLowerCase();
  return v === "prod" || v === "production" || v === "live" ? "prod" : "sandbox";
}

function baseUrl(asaasEnv) {
  // produção: https://api.asaas.com
  // sandbox:  https://api-sandbox.asaas.com
  return asaasEnv === "prod" ? "https://api.asaas.com" : "https://api-sandbox.asaas.com";
}

function assertConfigured() {
  const key = env("ASAAS_API_KEY");
  if (!key) {
    const err = new Error("ASAAS_API_KEY não configurada");
    err.code = "ASAAS_NOT_CONFIGURED";
    throw err;
  }
  return key;
}

function normalizeDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

async function asaasRequest(path, { method = "GET", body } = {}) {
  // ✅ lê SEMPRE na hora (não “congela” na importação)
  const asaasEnv = getAsaasEnv();
  const apiKey = assertConfigured();

  const url = `${baseUrl(asaasEnv)}${path}`;

  const headers = {
    "Content-Type": "application/json",
    access_token: apiKey,
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
    err.payload = {
      ...json,
      asaas: {
        env: asaasEnv,
        baseUrl: baseUrl(asaasEnv),
        path,
        method
      }
    };
    throw err;
  }

  return json;
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
  return asaasRequest("/v3/subscriptions", { method: "POST", body: { ...payload } });
}

export async function asaasGetSubscription(subscriptionId) {
  return asaasRequest(`/v3/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

// ✅ config “dinâmico” (pra logs)
export const asaasConfig = {
  get env() {
    return getAsaasEnv();
  },
  get baseUrl() {
    return baseUrl(getAsaasEnv());
  }
};
