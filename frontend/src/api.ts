// frontend/src/api.ts
// Central de chamadas da API da plataforma GP Labs

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3010";

// Helper genérico de fetch
async function request(path: string, options: RequestInit = {}) {
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

  try {
    return await res.json();
  } catch {
    return null;
  }
}

// ============================
// AUTENTICAÇÃO
// ============================
export async function login(email: string, password: string) {
  return request("/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
}

// ============================
// CONVERSAS
// ============================
export async function fetchConversations(status: string = "open") {
  const qs =
    status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return request(`/conversations${qs}`);
}

export async function fetchMessages(conversationId: number) {
  return request(`/conversations/${conversationId}/messages`);
}

/**
 * ENVIO DE TEXTO
 * IMPORTANTE: agora usa /conversations/:id/messages (sem /text)
 * para bater com o backend novo.
 */
export async function sendTextMessage(
  conversationId: number,
  text: string
) {
  return request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text })
  });
}

/**
 * ENVIO DE MÍDIA
 * Bate com POST /conversations/:id/media no backend.
 */
export async function sendMediaMessage(
  conversationId: number,
  payload: {
    type: string;
    mediaUrl: string;
    caption?: string;
  }
) {
  return request(`/conversations/${conversationId}/media`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

/**
 * ALTERAR STATUS (open/closed) + tags
 */
export async function updateConversationStatus(
  conversationId: number,
  status: "open" | "closed",
  extraData?: { tags?: string[] }
) {
  return request(`/conversations/${conversationId}/status`, {
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
) {
  return request(`/conversations/${conversationId}/notes`, {
    method: "PATCH",
    body: JSON.stringify({ notes })
  });
}

// ============================
// (RESERVADO) CONFIGURAÇÕES / TAGS FUTURO
// ============================
// Quando criarmos as rotas de configurações (tags, grupos etc.),
// podemos centralizar aqui, ex:
//
// export async function fetchSettings() { ... }
// export async function saveTags(tags: string[]) { ... }
