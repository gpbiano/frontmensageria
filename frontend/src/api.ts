// ============================================
// frontend/src/api.ts
// API unificada · Suporte a inbound e outbound
// ============================================

// Detecta ambiente com proteção para SSR / TS
const isBrowser = typeof window !== "undefined";

const isLocalDev =
  isBrowser &&
  (window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1");

// Se for dev → usa backend local
// Se for produção → usa VITE_API_BASE ou fallback
const API_BASE: string = isLocalDev
  ? "http://localhost:3010"
  : (import.meta.env.VITE_API_BASE &&
      String(import.meta.env.VITE_API_BASE).trim()) ||
    "https://api.gplabs.com.br";

console.log("🌐 API_BASE (frontend):", API_BASE);

// **Exporta para outros arquivos (ex: MessageRenderer)**
export const API_BASE_URL = API_BASE;

// ------------------------------------------------
// HELPERS GENÉRICOS
// ------------------------------------------------

async function apiGet(path: string) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ GET ${url} -> ${res.status}`, text);
    throw new Error(text || "Erro na API");
  }

  return res.json();
}

async function apiPost(path: string, body: any) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ POST ${url} -> ${res.status}`, text);
    throw new Error(text || "Erro na API");
  }

  return res.json();
}

async function apiPatch(path: string, body: any) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ PATCH ${url} -> ${res.status}`, text);
    throw new Error(text || "Erro na API");
  }

  return res.json();
}

// ======================================================
// ATENDIMENTO / INBOUND
// ======================================================

/**
 * Lista conversas com filtro (all | open | closed)
 */
export async function fetchConversations(status?: string) {
  const query =
    status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return apiGet(`/conversations${query}`);
}

/**
 * Lista mensagens da conversa
 */
export async function fetchMessages(conversationId: number) {
  return apiGet(`/conversations/${conversationId}/messages`);
}

/**
 * Envia texto
 */
export async function sendTextMessage(conversationId: number, text: string) {
  return apiPost(`/conversations/${conversationId}/messages`, { text });
}

/**
 * Envia mídia (imagem, vídeo, áudio, documento)
 * payload: { type, mediaUrl, caption? }
 */
export async function sendMediaMessage(
  conversationId: number,
  payload: {
    type: string;
    mediaUrl: string;
    caption?: string;
  }
) {
  return apiPost(`/conversations/${conversationId}/media`, payload);
}

/**
 * Atualiza status (open | closed)
 */
export async function updateConversationStatus(
  conversationId: number,
  status: "open" | "closed"
) {
  return apiPatch(`/conversations/${conversationId}/status`, { status });
}

// ======================================================
// OUTBOUND (Campanhas / Templates / Biblioteca de Mídia)
// ======================================================

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

