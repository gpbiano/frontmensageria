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

// ============================
// HELPER GENÉRICO DE FETCH
// ============================

async function request<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("gpLabsAuthToken")
      : null;

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
// AUTENTICAÇÃO
// ============================

export async function login(
  email: string,
  password: string
): Promise<LoginResponse> {
  // aqui não precisamos do token; o helper ainda tenta pegar do localStorage,
  // mas o backend simplesmente ignora o header se vier.
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
// OUTBOUND – Templates & Mídias
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
 * payload deve ter obrigatoriamente: name, category, language, components
 *
 * O backend responde:
 * { success: true, template: Template }
 *
 * Aqui já devolvemos diretamente o Template para simplificar o uso no front.
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

/**
 * Lista biblioteca de mídia (assets)
 * GET /outbound/assets
 */
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
// export async function fetchSettings() { ... }
// export async function saveTags(tags: string[]) { ... }
