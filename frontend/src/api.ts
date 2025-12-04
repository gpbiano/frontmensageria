// frontend/src/api.ts

// Detecta se estamos rodando localmente (dev)
const isLocalDev =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

// Se for localhost, força falar com o backend local.
// Em qualquer outro host (produção), usa o VITE_API_BASE do .env.
const API_BASE = isLocalDev
  ? "http://localhost:3010"
  : (import.meta.env.VITE_API_BASE?.trim() ||
     "https://bot.gphparticipacoes.com.br");

console.log("🌐 API_BASE (frontend):", API_BASE);

// Helper genérico para GET
async function apiGet(path: string) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ GET ${url} -> ${res.status}`, text);
    throw new Error(`Erro na API: ${res.status}`);
  }

  return res.json();
}

// Helper genérico para POST
async function apiPost(path: string, body: any) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ POST ${url} -> ${res.status}`, text);
    throw new Error(`Erro na API: ${res.status}`);
  }

  return res.json();
}

// ===============================
// ATENDIMENTO (inbound)
// ===============================

export async function fetchConversations() {
  return apiGet("/conversations");
}

export async function fetchMessages(conversationId: number) {
  return apiGet(`/conversations/${conversationId}/messages`);
}

export async function sendMessageToConversation(
  conversationId: number,
  text: string
) {
  return apiPost(`/conversations/${conversationId}/messages`, { text });
}

// ===============================
// OUTBOUND – Campaigns / Templates / Media
// ===============================

export async function fetchCampaigns() {
  return apiGet("/campaigns");
}

export async function createCampaign(payload: any) {
  return apiPost("/campaigns", payload);
}

export async function sendCampaign(id: number) {
  return apiPost(`/campaigns/${id}/send`, {});
}

export async function fetchTemplates() {
  return apiGet("/templates");
}

export async function createTemplate(payload: any) {
  return apiPost("/templates", payload);
}

export async function fetchMediaLibrary() {
  return apiGet("/media-library");
}

export async function createMediaItem(payload: any) {
  return apiPost("/media-library", payload);
}

