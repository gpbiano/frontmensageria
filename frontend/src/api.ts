/// <reference types="vite/client" />
// frontend/src/api.ts
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001";

export interface Conversation {
  id: number;
  contactName: string;
  phone: string;
  lastMessage: string;
  status: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  direction: "in" | "out";
  text: string;
  timestamp: string;
}

// Lista de conversas
export async function fetchConversations(): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE_URL}/conversations`);
  if (!res.ok) {
    throw new Error("Erro ao carregar conversas");
  }
  return res.json();
}

// Mensagens de uma conversa
export async function fetchMessages(
  conversationId: number
): Promise<Message[]> {
  const res = await fetch(
    `${API_BASE_URL}/conversations/${conversationId}/messages`
  );
  if (!res.ok) {
    throw new Error("Erro ao carregar mensagens");
  }
  return res.json();
}

// Enviar mensagem (botão Responder/Enviar)
export async function sendMessage(
  conversationId: number,
  text: string
): Promise<Message> {
  const res = await fetch(
    `${API_BASE_URL}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    }
  );

  if (!res.ok) {
    throw new Error("Erro ao enviar mensagem");
  }

  const data = await res.json();
  // o backend devolve { msg, waResponse }
  return data.msg as Message;
}