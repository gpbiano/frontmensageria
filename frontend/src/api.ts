const API_BASE = "http://localhost:3010";

// lista de conversas
export async function getConversations() {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error("Erro ao carregar conversas");
  return res.json();
}

// mensagens por conversa
export async function getMessages(conversationId: number) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`);
  if (!res.ok) throw new Error("Erro ao carregar mensagens");
  return res.json();
}

// enviar mensagem
export async function sendMessage(conversationId: number, text: string) {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) throw new Error("Erro ao enviar mensagem");
  return res.json();
}