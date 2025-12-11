// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs

// Observação: mantemos compatibilidade com duas envs possíveis
// VITE_API_BASE (padrão da doc) e VITE_API_BASE_URL (fallback).
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

// ============================
// TIPAGENS GERAIS
// ============================

export type ConversationStatus = "open" | "closed";

export interface Conversation {
  id: number;
  status: ConversationStatus;
  currentMode?: "bot" | "human";
  botAttempts?: number;
  updatedAt?: string;
  [key: string]: any;
}

export interface Message {
  id?: string | number;
  waMessageId?: string;
  from?: "agent" | "customer" | "bot";
  text?: string;
  type?: string;
  mediaUrl?: string;
  createdAt?: string;
  [key: string]: any;
}

export interface PhoneNumberRecord {
  name: string;
  displayNumber: string; // ex.: "MEX +52 15595000623"
  quality?: string; // "Alta" | "Média" | "Baixa"...
  limitPerDay?: number;
  connected?: boolean;
  updatedAt?: string;
  [key: string]: any;
}

export interface LoginResponse {
  token: string;
  user?: {
    id?: string | number;
    email?: string;
    name?: string;
    [key: string]: any;
  };
}

export interface Template {
  id: string | number;
  name: string;
  category?: string;
  language?: string;
  status?: string;
  [key: string]: any;
}

export interface MediaItem {
  id: string | number;
  label: string;
  type: string;
  url: string;
  createdAt?: string;
  [key: string]: any;
}

// ============================
// HELPER GENÉRICO DE FETCH
// ============================

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("Erro na API:", res.status, text);
    throw new Error(
      `Erro na API (${res.status}) em ${path}: ${text || "sem corpo"}`
    );
  }

  // se não houver corpo JSON, retornamos null
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

export async function fetchMessages(
  conversationId: number
): Promise<Message[]> {
  return request<Message[]>(`/conversations/${conversationId}/messages`);
}

// ============================
// NÚMEROS (PHONE NUMBERS)
// ============================

/**
 * Lista de números conectados (lê de numbers.json no backend)
 * GET /outbound/numbers
 */
export async function fetchNumbers(): Promise<PhoneNumberRecord[]> {
  return request<PhoneNumberRecord[]>("/outbound/numbers");
}

/**
 * Força sincronização com a Meta:
 * POST /outbound/numbers/sync
 * Backend consulta Graph API e atualiza numbers.json.
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
  return request<Conversation>(
    `/conversations/${conversationId}/status`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status,
        ...(extraData || {})
      })
    }
  );
}

/**
 * SALVAR NOTAS DO ATENDENTE
 */
export async function updateConversationNotes(
  conversationId: number,
  notes: string
): Promise<Conversation> {
  return request<Conversation>(
    `/conversations/${conversationId}/notes`,
    {
      method: "PATCH",
      body: JSON.stringify({ notes })
    }
  );
}

// ============================
// OUTBOUND – Templates & Mídias
// (baseado nos routers outbound/templates & outbound/assets) 
// ============================

export async function fetchTemplates(): Promise<Template[]> {
  try {
    const data = await request<any>("/outbound/templates");
    return Array.isArray(data) ? (data as Template[]) : [];
  } catch (err) {
    console.error("fetchTemplates() erro:", err);
    return [];
  }
}

export async function fetchMediaLibrary(): Promise<MediaItem[]> {
  try {
    const data = await request<any>("/outbound/assets");
    return Array.isArray(data) ? (data as MediaItem[]) : [];
  } catch (err) {
    console.error("fetchMediaLibrary() erro:", err);
    return [];
  }
}

/**
 * Stub local para criação de item de mídia.
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
    };
  } catch (err) {
    console.error("createMediaItem() erro:", err);
    throw err;
  }
}

// ============================
// (RESERVADO) CONFIGURAÇÕES / TAGS FUTURO
// ============================
// Quando criarmos as rotas de configurações (tags, grupos etc.),
// podemos centralizar aqui, ex:
//
// export async function fetchSettings() { ... }
// export async function saveTags(tags: string[]) { ... }
