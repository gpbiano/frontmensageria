import { useEffect, useState } from "react";
import { fetchConversations, fetchMessages, sendMessage } from "../api";

export function ChatPanel() {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loadingSend, setLoadingSend] = useState(false);

  useEffect(() => {
    (async () => {
      const data = await fetchConversations();
      setConversations(data);
      if (data.length > 0) {
        setSelectedId(data[0].id);
      }
    })();
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    (async () => {
      const msgs = await fetchMessages(selectedId);
      setMessages(msgs);
    })();
  }, [selectedId]);

  async function handleSend() {
    if (!selectedId || !input.trim()) return;

    setLoadingSend(true);

    const optimistic = {
      id: messages.length + 1,
      direction: "out",
      text: input,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimistic]);

    try {
      await sendMessage(selectedId, input);
      setInput("");
    } catch (err) {
      console.error(err);
      alert("Erro ao enviar mensagem");
    }

    setLoadingSend(false);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside style={{ width: 280, borderRight: "1px solid #ddd" }}>
        <h3 style={{ padding: "8px 12px" }}>Conversas</h3>

        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            style={{
              padding: 12,
              cursor: "pointer",
              background: selectedId === c.id ? "#eef" : "white",
              borderBottom: "1px solid #f0f0f0",
            }}
          >
            <strong>{c.contactName}</strong>
            <br />
            <span style={{ fontSize: 12, color: "#666" }}>
              {c.lastMessage}
            </span>
          </div>
        ))}
      </aside>

      <main style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          {messages.map((m) => (
            <div
              key={m.id}
              style={{
                textAlign: m.direction === "out" ? "right" : "left",
                marginBottom: 10,
              }}
            >
              <span
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  background:
                    m.direction === "out" ? "#DCF8C6" : "#F1F0F0",
                }}
              >
                {m.text}
              </span>
            </div>
          ))}
        </div>

        <div
          style={{
            padding: 12,
            borderTop: "1px solid #ddd",
            display: "flex",
            gap: 8,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Digite uma mensagem…"
            style={{ flex: 1, padding: 8 }}
          />

          <button onClick={handleSend} disabled={loadingSend}>
            {loadingSend ? "Enviando..." : "Enviar"}
          </button>
        </div>
      </main>
    </div>
  );
}
