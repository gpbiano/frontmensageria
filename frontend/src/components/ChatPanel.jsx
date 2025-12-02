import { useEffect, useState } from "react";
import { getConversations, getMessages, sendMessage } from "../api";

export default function ChatPanel() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Carrega conversas com polling
  useEffect(() => {
    let stop = false;

    async function load() {
      const data = await getConversations();
      if (!stop) setConversations(data);
    }

    load();
    const interval = setInterval(load, 2000);

    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, []);

  // Carrega mensagens de uma conversa com polling
  useEffect(() => {
    if (!selectedId) return;

    let stop = false;

    async function load() {
      const data = await getMessages(selectedId);
      if (!stop) setMessages(data);
    }

    load();
    const interval = setInterval(load, 1500);

    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  // Envio da mensagem
  async function handleSend() {
    if (!selectedId || !input.trim()) return;

    setIsSending(true);
    await sendMessage(selectedId, input);
    setInput("");

    const updated = await getMessages(selectedId);
    setMessages(updated);

    setIsSending(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      {/* Lista de conversas */}
      <aside style={{ width: 280, padding: 16, borderRight: "1px solid #ddd", overflowY: "auto" }}>
        <h2>Conversas</h2>

        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{
              background: selectedId === c.id ? "#e5e7eb" : "#f9fafb",
              padding: 10,
              borderRadius: 8,
              marginBottom: 8,
              cursor: "pointer",
            }}
          >
            <strong>{c.contactName}</strong>
            <div style={{ fontSize: 12, color: "#666" }}>
              {c.lastMessage || "Sem mensagens"}
            </div>
          </div>
        ))}
      </aside>

      {/* Painel de mensagens */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header style={{ padding: 16, borderBottom: "1px solid #ddd" }}>
          {selectedId ? (
            <strong>Conversa #{selectedId}</strong>
          ) : (
            <span style={{ color: "#888" }}>Selecione uma conversa</span>
          )}
        </header>

        {/* Área de mensagens */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent: m.direction === "out" ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  background: m.direction === "out" ? "#bbf7d0" : "#fff",
                  border: "1px solid #ccc",
                  padding: "8px 12px",
                  borderRadius: 10,
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        {/* Caixa de envio */}
        <footer style={{ padding: 16, borderTop: "1px solid #ddd", display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Digite uma mensagem..."
            style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ccc" }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            style={{
              background: "#16a34a",
              color: "#fff",
              border: "none",
              padding: "10px 16px",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </footer>
      </main>
    </div>
  );
}
