// frontend/src/api.ts

// =======================================
// API BASE FIXA (para usar o backend real)
// =======================================
const API_BASE = "https://bot.gphparticipacoes.com.br";

console.log("🔥 API BASE:", API_BASE);

// ===============================
// Lista de conversas
// ===============================
export async function getConversations() {
  const res = await fetch(`${API_BASE}/conversations`);
  if (!res.ok) throw new Error("Erro ao carregar conversas");
  return res.json();
}

// ===============================
// Mensagens por conversa
// ===============================
export async function getMessages(conversationId: number) {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages`
  );
  if (!res.ok) throw new Error("Erro ao carregar mensagens");
  return res.json();
}

// ===============================
// Enviar mensagem
// ===============================
export async function sendMessage(conversationId: number, text: string) {
  const res = await fetch(
    `${API_BASE}/conversations/${conversationId}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }
  );

  if (!res.ok) throw new Error("Erro ao enviar mensagem");
  return res.json();
}
