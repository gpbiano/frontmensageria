// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs

import type {
  Conversation,
  ConversationStatus,
  LoginResponse,
  MediaItem,
  Message,
  PhoneNumberRecord,
  Template
} from "./types";

/**
 * Base da API
 * Compatível com:
 * - VITE_API_BASE (padrão)
 * - VITE_API_BASE_URL (fallback)
 * - localhost (dev)
 */
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";

// ======================================================
// HELPERS DE AUTENTICAÇÃO
// ======================================================

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_KEY);
}

function buildHeaders(extra?: HeadersInit): HeadersInit {
  const token = getToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {})
  };
}

// ======================================================
// HELPER FETCH JSON
// ======================================================

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: buildHeaders({
      "Content-Type": "application/json",
      ...(options.headers || {})
    })
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("❌ API ERROR:", res.status, path, text);
    throw new Error(
      `Erro na API (${res.status}) ${path}: ${text || "sem corpo"}`
    );
  }

  // tenta JSON; se não for JSON, retorna null
  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

// ======================================================
// HELPER FETCH FORM-DATA (UPLOAD)
// ======================================================

async function requestForm<T = any>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    method: options.method || "POST",
    headers: buildHeaders(options.headers), // NÃO seta Content-Type aqui (boundary)
    body: formData
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("❌ API FORM ERROR:", res.status, path, text);
    throw new Error(
      `Erro na API (${res.status}) ${path}: ${text || "sem corpo"}`
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

// ======================================================
// AUTH
// ======================================================

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  const data = await request<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

  if (data?.token && typeof window !== "undefined") {
    localStorage.setItem(AUTH_KEY, data.token);
  }

  return data;
}

export function logout(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_KEY);
}

// ======================================================
// CONVERSAS
// ======================================================

export async function fetchConversations(
  status: ConversationStatus | "all" = "open"
): Promise<Conversation[]> {
  const qs =
    status && status !== "all"
      ? `?status=${encodeURIComponent(status)}`
      : "";

  const data = await request<any>(`/conversations${qs}`);
  return Array.isArray(data) ? (data as Conversation[]) : [];
}

export async function fetchMessages(conversationId: number): Promise<Message[]> {
  const data = await request<any>(`/conversations/${conversationId}/messages`);
  return Array.isArray(data) ? (data as Message[]) : [];
}

export async function sendTextMessage(
  conversationId: number,
  text: string
): Promise<Message> {
  return request<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

export async function sendMediaMessage(
  conversationId: number,
  payload: {
    type: string;
    mediaUrl: string;
    caption?: string;
  }
): Promise<Message> {
  return request<Message>(`/conversations/${conversationId}/media`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function updateConversationStatus(
  conversationId: number,
  status: ConversationStatus,
  extra?: { tags?: string[] }
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, ...(extra || {}) })
  });
}

export async function updateConversationNotes(
  conversationId: number,
  notes: string
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
}

// ======================================================
// OUTBOUND — NÚMEROS
// ======================================================

export async function fetchNumbers(): Promise<PhoneNumberRecord[]> {
  const data = await request<any>("/outbound/numbers");
  return Array.isArray(data) ? (data as PhoneNumberRecord[]) : [];
}

export async function syncNumbers(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/outbound/numbers/sync", {
    method: "POST"
  });
}

// ======================================================
// OUTBOUND — TEMPLATES
// ======================================================

export async function fetchTemplates(): Promise<Template[]> {
  const data = await request<any>("/outbound/templates");
  return Array.isArray(data) ? (data as Template[]) : [];
}

export async function syncTemplates(): Promise<{ success: boolean }> {
  return request<{ success: boolean }>("/outbound/templates/sync", {
    method: "POST"
  });
}

export async function createTemplate(payload: {
  name: string;
  category: string;
  language: string;
  components: any[];
}): Promise<Template> {
  const res = await request<{ success: boolean; template: Template }>(
    "/outbound/templates",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
  return res.template;
}

// ===============================
// OUTBOUND – ASSETS (ARQUIVOS)
// ===============================

export async function fetchAssets(): Promise<MediaItem[]> {
  const data = await request<any>("/outbound/assets");
  return Array.isArray(data) ? (data as MediaItem[]) : [];
}

export async function uploadAsset(file: File): Promise<MediaItem> {
  const form = new FormData();
  form.append("file", file);
  return requestForm<MediaItem>("/outbound/assets/upload", form);
}

export async function deleteAsset(
  id: string | number
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/assets/${encodeURIComponent(String(id))}`,
    { method: "DELETE" }
  );
}

// ======================================================
// OUTBOUND — CAMPANHAS
// ======================================================

export type CampaignStatus = "draft" | "ready" | "sending" | "done" | "failed";

export interface CampaignAudience {
  fileName?: string | null;
  totalRows?: number;
  validRows?: number;
  invalidRows?: number;
}

export interface CampaignResultItem {
  phone: string;
  status: "sent" | "failed";
  waMessageId?: string | null;
  error?: string;
}

export interface CampaignRecord {
  id: string;
  name: string;
  numberId: string;
  templateName: string;
  excludeOptOut?: boolean;
  status: CampaignStatus;
  createdAt: string;
  updatedAt?: string;
  audience?: CampaignAudience;
  results?: CampaignResultItem[];
  logs?: Array<{ at: string; type: string; message: string }>;
}

export async function fetchCampaigns(): Promise<CampaignRecord[]> {
  const data = await request<any>("/outbound/campaigns");
  return Array.isArray(data) ? (data as CampaignRecord[]) : [];
}

export async function createCampaign(payload: {
  name: string;
  numberId: string;
  templateName: string;
  excludeOptOut?: boolean;
}): Promise<CampaignRecord> {
  return request<CampaignRecord>("/outbound/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export async function uploadCampaignAudience(
  campaignId: string,
  file: File
): Promise<{
  success: boolean;
  campaignId: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
}> {
  const fd = new FormData();
  fd.append("file", file);

  return requestForm(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/audience`,
    fd
  );
}

export async function startCampaign(
  campaignId: string
): Promise<{ success: boolean; sent?: number; failed?: number }> {
  return request<{ success: boolean; sent?: number; failed?: number }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/start`,
    { method: "POST" }
  );
}

// (ainda não implementados no backend — deixamos, mas tipados como opcionais)
export async function pauseCampaign(
  campaignId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/pause`,
    { method: "PATCH" }
  );
}

export async function resumeCampaign(
  campaignId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/resume`,
    { method: "PATCH" }
  );
}

export async function fetchCampaignById(
  campaignId: string
): Promise<CampaignRecord> {
  return request<CampaignRecord>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}`
  );
}

// ======================================================
// OUTBOUND — OPT-OUT
// ======================================================

export interface OptOutItem {
  id: string;
  phone: string;
  name?: string;
  source: "manual" | "csv" | "whatsapp" | "flow" | "webhook";
  reason?: string;
  createdAt: string;
}

export async function fetchOptOut(params?: {
  page?: number;
  limit?: number;
  search?: string;
  source?: string;
  from?: string;
  to?: string;
}) {
  const qs = new URLSearchParams();

  if (params?.page) qs.set("page", String(params.page));
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.search) qs.set("search", params.search);
  if (params?.source) qs.set("source", params.source);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);

  // backend retorna { data, total, page, limit }
  return request<{
    data: OptOutItem[];
    total: number;
    page: number;
    limit: number;
  }>(`/outbound/optout?${qs.toString()}`);
}

export async function createOptOut(payload: {
  phone: string;
  name?: string;
  reason?: string;
  source?: "manual";
}) {
  return request<{ success: boolean; duplicate?: boolean }>(
    "/outbound/optout",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );
}

export async function deleteOptOut(id: string) {
  return request<{ success: boolean }>(
    `/outbound/optout/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}

// (seu backend pode não ter isso ainda; mantenho pra não quebrar UI,
// mas se 404, é porque a rota ainda não foi criada)
export async function importOptOutCSV(file: File) {
  const fd = new FormData();
  fd.append("file", file);

  return requestForm<{
    total: number;
    imported: number;
    skipped: number;
  }>("/outbound/optout/import/csv", fd);
}

// backend atual retorna { data, total }
export async function fetchOptOutWhatsAppContacts() {
  return request<{
    data: { phone: string; name?: string }[];
    total: number;
  }>("/outbound/optout/whatsapp-contacts");
}

export async function downloadOptOutExport(params?: {
  search?: string;
  source?: string;
  from?: string;
  to?: string;
}) {
  const qs = new URLSearchParams();
  if (params?.search) qs.set("search", params.search);
  if (params?.source) qs.set("source", params.source);
  if (params?.from) qs.set("from", params.from);
  if (params?.to) qs.set("to", params.to);

  const res = await fetch(
    `${API_BASE}/outbound/optout/export?${qs.toString()}`,
    { headers: buildHeaders() }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("❌ EXPORT ERROR:", res.status, text);
    throw new Error(`Erro ao exportar opt-out (${res.status})`);
  }

  const blob = await res.blob();
  const url = window.URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `optout-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  window.URL.revokeObjectURL(url);

  return { success: true };
}
