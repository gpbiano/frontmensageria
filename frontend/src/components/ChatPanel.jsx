import { useEffect, useState } from "react";
import {
  getConversations,
  getMessages,
  sendMessage,
} from "./apis";

export default function ChatPanel() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);

  // Carrega lista de conversas + polling a cada 3s
  useEffect(() => {
    let isCancelled = false;

    async function fetchConversations() {
      try {
        const data = await getConversations();
        if (!isCancelled) {
          setConversations(data);
        }
      } catch (err) {
        console.error("Erro ao carregar conversas:", err);
      }
    }

    fetchConversations();
    const interval = setInterval(fetchConversations, 3000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Carrega mensagens da conversa selecionada + polling a cada 2s
  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }

    let isCancelled = false;

    async function fetchMessages() {
      try {
        const data = await getMessages(selectedId);
        if (!isCancelled) {
          setMessages(data);
        }
      } catch (err) {
        console.error("Erro ao carregar mensagens:", err);
      }
    }

    fetchMessages();
    const interval = setInterval(fetchMessages, 2000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [selectedId]);

  async function handleSend() {
    if (!selectedId || !input.trim()) return;
    setIsSending(true);

    try {
      await sendMessage(selectedId, input.trim());
      setInput("");

      // Atualiza mensagens logo depois de enviar
      const data = await getMessages(selectedId);
      setMessages(data);
    } catch (err) {
      console.error(err);
      alert("Erro ao enviar mensagem");
    } finally {
      setIsSending(false);
    }
  }

  const selectedConversation = conversations.find(
    (c) => c.id === selectedId
  );

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "sans-serif" }}>
      {/* Lista de conversas */}
      <aside
        style={{
          width: 280,
          borderRight: "1px solid #e5e7eb",
          padding: 16,
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginBottom: 12 }}>Conversas</h2>

        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{
              padding: 8,
              marginBottom: 8,
              borderRadius: 8,
              cursor: "pointer",
              backgroundColor: c.id === selectedId ? "#e5e7eb" : "#f9fafb",
            }}
          >
            <div style={{ fontWeight: 600 }}>{c.contactName}</div>
            <div
              style={{
                fontSize: 12,
                color: "#6b7280",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {c.lastMessage || "Sem mensagens ainda"}
            </div>
          </div>
        ))}
      </aside>

      {/* Painel de mensagens */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <header
          style={{
            padding: 16,
            borderBottom: "1px solid #e5e7eb",
            background: "#f9fafb",
          }}
        >
          {selectedConversation ? (
            <>
              <div style={{ fontWeight: 600 }}>
                {selectedConversation.contactName}
              </div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {selectedConversation.phone}
              </div>
            </>
          ) : (
            <span style={{ color: "#6b7280" }}>
              Selecione uma conversa à esquerda
            </span>
          )}
        </header>

        {/* Lista de mensagens */}
        <div
          style={{
            flex: 1,
            padding: 16,
            overflowY: "auto",
            background: "#f3f4f6",
          }}
        >
          {selectedId && messages.length === 0 && (
            <div style={{ color: "#6b7280", fontSize: 14 }}>
              Nenhuma mensagem ainda.
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                justifyContent:
                  m.direction === "out" ? "flex-end" : "flex-start",
                marginBottom: 8,
              }}
            >
              <div
                style={{
                  maxWidth: "70%",
                  padding: "8px 12px",
                  borderRadius: 12,
                  backgroundColor:
                    m.direction === "out" ? "#bbf7d0" : "#ffffff",
                  border:
                    m.direction === "out"
                      ? "1px solid #22c55e"
                      : "1px solid #e5e7eb",
                  fontSize: 14,
                  whiteSpace: "pre-wrap",
                }}
              >
                {m.text}
              </div>
            </div>
          ))}
        </div>

        {/* Caixa de envio */}
        <footer
          style={{
            padding: 12,
            borderTop: "1px solid #e5e7eb",
            display: "flex",
            gap: 8,
          }}
        >
          <input
            type="text"
            placeholder={
              selectedId
                ? "Digite uma mensagem..."
                : "Selecione uma conversa para enviar"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSend();
            }}
            disabled={!selectedId || isSending}
            style={{
              flex: 1,
              padding: "8px 12px",
              borderRadius: 8,
              border: "1px solid #d1d5db",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!selectedId || isSending || !input.trim()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              backgroundColor: "#16a34a",
              color: "white",
              fontWeight: 600,
              cursor:
                !selectedId || isSending || !input.trim()
                  ? "not-allowed"
                  : "pointer",
              opacity:
                !selectedId || isSending || !input.trim() ? 0.6 : 1,
            }}
          >
            {isSending ? "Enviando..." : "Enviar"}
          </button>
        </footer>
      </main>
    </div>
  );
}
