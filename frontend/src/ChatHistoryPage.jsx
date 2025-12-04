// frontend/src/ChatHistoryPage.jsx
import { useEffect, useState, useMemo } from "react";
import {
  fetchConversations,
  fetchMessages,
  sendMessageToConversation,
} from "./api";

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newMessage, setNewMessage] = useState("");

  // ===============================
  // LOAD CONVERSAS
  // ===============================
  async function loadConversations() {
    try {
      setLoadingConversations(true);
      const data = await fetchConversations();
      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("❌ Erro ao buscar conversas:", err);
      alert("Erro ao buscar conversas. Veja o console para mais detalhes.");
    } finally {
      setLoadingConversations(false);
    }
  }

  useEffect(() => {
    loadConversations();
  }, []);

  // ===============================
  // LOAD MENSAGENS DA CONVERSA
  // ===============================
  async function loadMessages(conversationId) {
    try {
      setLoadingMessages(true);
      const data = await fetchMessages(conversationId);
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("❌ Erro ao buscar mensagens:", err);
      alert("Erro ao buscar mensagens. Veja o console.");
    } finally {
      setLoadingMessages(false);
    }
  }

  function handleSelectConversation(convId) {
    setSelectedConversationId(convId);
    setMessages([]);
    if (convId != null) {
      loadMessages(convId);
    }
  }

  // ===============================
  // ENVIO DE MENSAGEM PELO CHAT
  // ===============================
  async function handleSendMessage(e) {
    e.preventDefault();
    if (!selectedConversationId || !newMessage.trim()) return;

    try {
      setSending(true);
      await sendMessageToConversation(selectedConversationId, newMessage.trim());
      setNewMessage("");
      await loadMessages(selectedConversationId);
      await loadConversations(); // pra atualizar lastMessage e updatedAt
    } catch (err) {
      console.error("❌ Erro ao enviar mensagem:", err);
      alert("Erro ao enviar mensagem. Veja o console.");
    } finally {
      setSending(false);
    }
  }

  // ===============================
  // FILTROS & PESQUISA
  // ===============================
  const filteredConversations = useMemo(() => {
    return conversations.filter((c) => {
      const matchesSearch =
        !searchTerm.trim() ||
        c.contactName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone?.includes(searchTerm);

      const matchesStatus =
        statusFilter === "all" ? true : c.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [conversations, searchTerm, statusFilter]);

  const selectedConversation = conversations.find(
    (c) => c.id === selectedConversationId
  );

  // ===============================
  // RENDER
  // ===============================
  return (
    <div className="chat-history-layout">
      {/* Coluna esquerda - lista de conversas */}
      <section className="chat-history-sidebar">
        <header className="chat-history-header">
          <h1>Histórico de Chats</h1>
          <p>Veja todas as conversas recebidas pela plataforma.</p>
        </header>

        <div className="chat-history-search">
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="chat-history-filters">
          <button
            className={statusFilter === "all" ? "active" : ""}
            onClick={() => setStatusFilter("all")}
          >
            Todos
          </button>
          <button
            className={statusFilter === "open" ? "active" : ""}
            onClick={() => setStatusFilter("open")}
          >
            Abertos
          </button>
          <button
            className={statusFilter === "closed" ? "active" : ""}
            onClick={() => setStatusFilter("closed")}
          >
            Fechados
          </button>
        </div>

        <div className="chat-history-list">
          {loadingConversations ? (
            <div className="chat-history-empty">Carregando conversas...</div>
          ) : filteredConversations.length === 0 ? (
            <div className="chat-history-empty">
              Nenhuma conversa encontrada com os filtros atuais.
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <button
                key={conv.id}
                className={
                  "chat-history-item" +
                  (conv.id === selectedConversationId ? " selected" : "")
                }
                onClick={() => handleSelectConversation(conv.id)}
              >
                <div className="chat-history-item-main">
                  <span className="chat-history-contact-name">
                    {conv.contactName || "Contato sem nome"}
                  </span>
                  <span className="chat-history-phone">{conv.phone}</span>
                </div>
                <div className="chat-history-item-meta">
                  <span className="chat-history-last-message">
                    {conv.lastMessage || "Sem mensagens"}
                  </span>
                  <span className="chat-history-status">{conv.status}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {/* Coluna direita - detalhes da conversa */}
      <section className="chat-history-main">
        {!selectedConversation ? (
          <div className="chat-history-placeholder">
            <h2>Selecione uma conversa</h2>
            <p>
              Clique em uma conversa à esquerda para visualizar todo o
              histórico de mensagens.
            </p>
          </div>
        ) : (
          <div className="chat-history-thread">
            <header className="chat-history-thread-header">
              <div>
                <h2>{selectedConversation.contactName}</h2>
                <p>{selectedConversation.phone}</p>
              </div>
              <span className="chat-history-thread-status">
                Status: {selectedConversation.status}
              </span>
            </header>

            <div className="chat-history-messages">
              {loadingMessages ? (
                <div className="chat-history-empty">Carregando mensagens...</div>
              ) : messages.length === 0 ? (
                <div className="chat-history-empty">
                  Nenhuma mensagem nesta conversa ainda.
                </div>
              ) : (
                messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={
                      "chat-message-bubble " +
                      (msg.direction === "outbound" ? "outbound" : "inbound")
                    }
                  >
                    <div className="chat-message-body">
                      {msg.text || "[mensagem sem texto]"}
                    </div>
                    <div className="chat-message-meta">
                      <span>{msg.direction === "outbound" ? "Você" : "Cliente"}</span>
                      {msg.timestamp && (
                        <span>
                          {new Date(msg.timestamp).toLocaleString("pt-BR")}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            <form className="chat-history-input" onSubmit={handleSendMessage}>
              <textarea
                placeholder="Digite uma mensagem..."
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
              />
              <button type="submit" disabled={!newMessage.trim() || sending}>
                {sending ? "Enviando..." : "Enviar"}
              </button>
            </form>
          </div>
        )}
      </section>
    </div>
  );
}

