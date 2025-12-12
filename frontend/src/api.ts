// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs

import {
  Conversation,
  ConversationStatus,
  LoginResponse,
  MediaItem,
  Message,
  PhoneNumberRecord,
  Template
} from "./types";

// Observação: mantemos compatibilidade com duas envs possíveis
// VITE_API_BASE (padrão da doc) e VITE_API_BASE_URL (fallback).
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";

// ============================
// HELPER GENÉRICO DE FETCH
// ============================

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem(AUTH_KEY) : null;

  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Erro na API:", res.status, text);
    throw new Error(
      `Erro na API (${res.status}) em ${path}: ${text || "sem corpo"}`
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    // se não houver corpo JSON, retornamos null
    return null as T;
  }
}

// ============================
// HELPER PARA FORM-DATA (UPLOAD)
// ============================

async function requestForm<T = any>(
  path: string,
  formData: FormData,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined" ? localStorage.getItem(AUTH_KEY) : null;

  // ⚠️ Não setar Content-Type aqui. O browser define boundary automaticamente.
  const headers: HeadersInit = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    ...options,
    headers,
    body: formData
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Erro na API (FORM):", res.status, text);
    throw new Error(
      `Erro na API (${res.status}) em ${path}: ${text || "sem corpo"}`
    );
  }

  try {
    return (await res.json()) as T;
  } catch {
    return null as T;
  }
}

// ============================
// AUTENTICAÇÃO
// ============================

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  return request<LoginResponse>("/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

// ============================
// CONVERSAS
// ============================

export async function fetchConversations(
  status: ConversationStatus | "all" = "open"
): Promise<Conversation[]> {
  const qs =
    status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return request<Conversation[]>(`/conversations${qs}`);
}

export async function fetchMessages(conversationId: number): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

// ============================
// NÚMEROS (PHONE NUMBERS)
// ============================

/**
 * Lista de números conectados
 * GET /outbound/numbers
 */
export async function fetchNumbers(): Promise<PhoneNumberRecord[]> {
  return request<PhoneNumberRecord[]>("/outbound/numbers");
}

/**
 * Força sincronização com a Meta:
 * POST /outbound/numbers/sync
 */
export async function syncNumbers(): Promise<any> {
  return request<any>("/outbound/numbers/sync", {
    method: "POST"
  });
}

// ============================
// MENSAGENS – TEXTO E MÍDIA
// ============================

/**
 * ENVIO DE TEXTO
 * Usa POST /conversations/:id/messages
 */
export async function sendTextMessage(
  conversationId: number,
  text: string
): Promise<Message> {
  return request<Message>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

/**
 * ENVIO DE MÍDIA
 * POST /conversations/:id/media
 */
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

/**
 * ALTERAR STATUS (open/closed) + tags
 */
export async function updateConversationStatus(
  conversationId: number,
  status: ConversationStatus,
  extraData?: { tags?: string[] }
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/status`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      ...(extraData || {})
    })
  });
}

/**
 * SALVAR NOTAS DO ATENDENTE
 */
export async function updateConversationNotes(
  conversationId: number,
  notes: string
): Promise<Conversation> {
  return request<Conversation>(`/conversations/${conversationId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
}

// ============================
// OUTBOUND – Templates
// ============================

/**
 * Lista templates de mensagem aprovados
 * GET /outbound/templates
 */
export async function fetchTemplates(): Promise<Template[]> {
  try {
    const data = await request<any>("/outbound/templates");
    return Array.isArray(data) ? (data as Template[]) : [];
  } catch (err) {
    console.error("fetchTemplates() erro:", err);
    return [];
  }
}

/**
 * Força sincronização de templates com a Meta
 * POST /outbound/templates/sync
 */
export async function syncTemplates(): Promise<any> {
  return request<any>("/outbound/templates/sync", {
    method: "POST"
  });
}

/**
 * Cria um novo template na WABA via backend.
 */
export async function createTemplate(payload: {
  name: string;
  category: string;
  language: string;
  components: any[];
}): Promise<Template> {
  const data = await request<{ success: boolean; template: Template }>(
    "/outbound/templates",
    {
      method: "POST",
      body: JSON.stringify(payload)
    }
  );

  return data.template;
}

// ============================
// OUTBOUND – ASSETS (Arquivos)
// ============================

/**
 * Lista assets
 * GET /outbound/assets
 */
export async function fetchAssets(): Promise<MediaItem[]> {
  try {
    const data = await request<any>("/outbound/assets");
    return Array.isArray(data) ? (data as MediaItem[]) : [];
  } catch (err) {
    console.error("fetchAssets() erro:", err);
    return [];
  }
}

/**
 * Alias (compatibilidade com páginas antigas)
 */
export async function fetchMediaLibrary(): Promise<MediaItem[]> {
  return fetchAssets();
}

/**
 * Upload de asset
 * POST /outbound/assets/upload (field: file)
 *
 * ⚠️ Mantemos fallback /outbound/assets só por garantia,
 * mas o endpoint “correto” é /upload (igual router que montamos).
 */
export async function uploadAsset(file: File): Promise<MediaItem> {
  const fd = new FormData();
  fd.append("file", file);

  try {
    return await requestForm<MediaItem>("/outbound/assets/upload", fd);
  } catch (e) {
    // fallback (caso você tenha outro router antigo aceitando POST /outbound/assets)
    return await requestForm<MediaItem>("/outbound/assets", fd);
  }
}

/**
 * Delete de asset
 * DELETE /outbound/assets/:id
 */
export async function deleteAsset(
  assetId: string | number
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/assets/${encodeURIComponent(String(assetId))}`,
    { method: "DELETE" }
  );
}

/**
 * (Opcional) Stub local para criação de item de mídia (mantido)
 * No futuro, deve chamar POST /outbound/assets.
 */
export async function createMediaItem(payload: {
  label: string;
  type: string;
  url: string;
}): Promise<MediaItem> {
  try {
    console.log("createMediaItem() stub – payload:", payload);

    return {
      id: Date.now(),
      ...payload,
      createdAt: new Date().toISOString()
    } as any;
  } catch (err) {
    console.error("createMediaItem() erro:", err);
    throw err;
  }
}

// ============================
// OUTBOUND – Campanhas
// ============================

export type CampaignStatus =
  | "draft"
  | "ready"
  | "running"
  | "paused"
  | "finished"
  | "failed"
  | "canceled";

export interface CampaignRecord {
  id: string;
  name: string;
  numberId: string;
  templateName: string;
  status: CampaignStatus;
  createdAt: string;
  updatedAt?: string;
  audience?: {
    fileName?: string;
    totalRows?: number;
    validRows?: number;
    invalidRows?: number;
  };
}

/**
 * Lista campanhas
 * GET /outbound/campaigns
 */
export async function fetchCampaigns(): Promise<CampaignRecord[]> {
  const data = await request<any>("/outbound/campaigns");
  return Array.isArray(data) ? (data as CampaignRecord[]) : [];
}

/**
 * Cria campanha (Passo 1 do Wizard)
 * POST /outbound/campaigns
 */
export async function createCampaign(payload: {
  name: string;
  numberId: string;
  templateName: string;
  excludeOptOut?: boolean;
}): Promise<{ id: string }> {
  return request<{ id: string }>("/outbound/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * Upload da audiência (CSV) (Passo 2 do Wizard)
 * POST /outbound/campaigns/:id/audience
 */
export async function uploadCampaignAudience(
  campaignId: string,
  file: File
): Promise<{
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

/**
 * Inicia campanha (Passo 3 do Wizard)
 * POST /outbound/campaigns/:id/start
 */
export async function startCampaign(
  campaignId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/start`,
    { method: "POST" }
  );
}

/**
 * Pausar campanha
 * PATCH /outbound/campaigns/:id/pause
 */
export async function pauseCampaign(
  campaignId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/pause`,
    { method: "PATCH" }
  );
}

/**
 * Retomar campanha
 * PATCH /outbound/campaigns/:id/resume
 */
export async function resumeCampaign(
  campaignId: string
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}/resume`,
    { method: "PATCH" }
  );
}

/**
 * Buscar detalhes da campanha (opcional, útil pro Report)
 * GET /outbound/campaigns/:id
 */
export async function fetchCampaignById(
  campaignId: string
): Promise<CampaignRecord> {
  return request<CampaignRecord>(
    `/outbound/campaigns/${encodeURIComponent(campaignId)}`
  );
}
