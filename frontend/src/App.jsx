import { useState, useEffect } from "react";

export default function App() {
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [selected, setSelected] = useState(null);
  const [input, setInput] = useState("");

  // Carrega conversas ao iniciar
  useEffect(() => {
    fetch("http://localhost:3001/conversations")
      .then((res) => res.json())
      .then((data) => setConversations(data))
      .catch((err) => console.error("Erro ao carregar conversas:", err));
  }, []);

  // Formata hora de forma segura
  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  // Seleciona a conversa e traz histórico já salvo
  const openConversation = (conv) => {
    setSelected(conv);

    fetch("http://localhost:3001/conversations")
      .then((res) => res.json())
      .then(() => {
        fetch(`http://localhost:3001/conversations/${conv.id}/messages`)
          .then((res) => res.json())
          .then((data) => setMessages(data))
          .catch((err) =>
            console.error("Erro ao carregar mensagens:", err)
          );
      });
  };

  // Envia mensagem
  const sendMessage = () => {
    if (!input.trim() || !selected) return;

    const payload = { text: input };

    fetch(`http://localhost:3001/conversations/${selected.id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .then((data) => {
        const msg = data.msg || data; // garante que pega só a mensagem

        setMessages((prev) => [...prev, msg]);
        setInput("");
      })
      .catch((err) => console.error("Erro ao enviar mensagem:", err));
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {/* ======= SIDEBAR ======= */}
      <div
        style={{
          width: "280px",
          borderRight: "1px solid #ddd",
          padding: "20px",
        }}
      >
        <h2>Inbox</h2>

        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => openConversation(c)}
            style={{
              padding: "12px",
              marginBottom: "10px",
              cursor: "pointer",
              background: selected?.id === c.id ? "#eee" : "#fafafa",
              borderRadius: "8px",
            }}
          >
            <strong>{c.contactName}</strong>
            <br />
            <span style={{ fontSize: "12px", color: "#555" }}>
              {c.phone}
            </span>
          </div>
        ))}
      </div>

      {/* ======= CHAT ======= */}
      <div
        style={{
          flex: 1,
          padding: "20px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {selected ? (
          <>
            <h2>{selected.contactName}</h2>
            <p style={{ color: "#666" }}>{selected.phone}</p>

            {/* MENSAGENS */}
            <div
              style={{
                flex: 1,
                marginTop: "20px",
                marginBottom: "20px",
                overflowY: "auto",
                paddingRight: "10px",
              }}
            >
              {messages.map((m) => (
                <div
                  key={m.id}
                  style={{
                    textAlign: m.direction === "out" ? "right" : "left",
                    marginBottom: "20px",
                  }}
                >
                  <div
                    style={{
                      display: "inline-block",
                      maxWidth: "70%",
                      padding: "12px",
                      borderRadius: "12px",
                      background:
                        m.direction === "out"
                          ? "#D4F8C4"
                          : "#F1F1F1",
                    }}
                  >
                    <div style={{ marginBottom: "6px" }}>{m.text}</div>
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#666",
                        marginTop: "5px",
                      }}
                    >
                      {formatTime(m.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* INPUT */}
            <div style={{ display: "flex", gap: "10px" }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Digite uma mensagem..."
                style={{
                  flex: 1,
                  padding: "12px",
                  border: "1px solid #ccc",
                  borderRadius: "8px",
                }}
              />

              <button
                onClick={sendMessage}
                style={{
                  padding: "12px 22px",
                  background: "#28a745",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                }}
              >
                Enviar
              </button>
            </div>
          </>
        ) : (
          <p>Selecione uma conversa ao lado 👈</p>
        )}
      </div>
    </div>
  );
}

