// frontend/src/ChatHistoryPage.jsx
import { useEffect, useMemo, useState } from "react";

const API_BASE = "https://bot.gphparticipacoes.com.br";

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [newMessage, setNewMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);

  // ============ HELPERS ============

  const formatDateTime = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getStatusLabel = (status) => {
    if (status === "open") return "Aberta";
    if (status === "closed") return "Fechada";
    return "Indefinido";
  };

  const getInitials = (name, phone) => {
    if (name) {
      const parts = name.trim().split(" ");
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return (
        (parts[0][0] || "") + (parts[parts.length - 1][0] || "")
      ).toUpperCase();
    }
    if (phone) return phone.slice(-2);
    return "?";
  };

  // ============ LOADERS ============

  const loadConversations = async (options = { silent: false }) => {
    const { silent } = options;
    try {
      if (!silent) setLoadingConversations(true);

      const res = await fetch(`${API_BASE}/conversations`);
      const data = await res.json();
      const ordered = [...data].sort(
        (a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)
      );
      setConversations(ordered);

      if (!selectedConversationId && ordered.length > 0) {
        setSelectedConversationId(ordered[0].id);
      }
    } catch (err) {
      console.error("Erro ao buscar conversas:", err);
    } finally {
      if (!silent) setLoadingConversations(false);
    }
  };

  const loadMessages = async (
    conversationId,
    options = { silent: false }
  ) => {
    if (!conversationId) return;
    const { silent } = options;

    try {
      if (!silent) setLoadingMessages(true);

      const res = await fetch(
        `${API_BASE}/conversations/${conversationId}/messages`
      );
      const data = await res.json();
      const sorted = [...data].sort(
        (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
      );

      setMessages((prev) => {
        const prevLast = prev[prev.length - 1]?.timestamp;
        const nextLast = sorted[sorted.length - 1]?.timestamp;
        if (prev.length === sorted.length && prevLast === nextLast) {
          return prev;
        }
        return sorted;
      });
    } catch (err) {
      console.error("Erro ao buscar mensagens:", err);
    } finally {
      if (!silent) setLoadingMessages(false);
    }
  };

  // primeira carga
  useEffect(() => {
    loadConversations();
  }, []);

  // quando troca conversa
  useEffect(() => {
    if (selectedConversationId) {
      loadMessages(selectedConversationId);
    } else {
      setMessages([]);
    }
  }, [selectedConversationId]);

  // polling leve (sem piscar)
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations({ silent: true });
      if (selectedConversationId) {
        loadMessages(selectedConversationId, { silent: true });
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [selectedConversationId]);

  // ============ MEMOS ============

  const filteredConversations = useMemo(
    () =>
      conversations.filter((conv) => {
        const matchesSearch =
          !searchTerm ||
          (conv.contactName &&
            conv.contactName
              .toLowerCase()
              .includes(searchTerm.toLowerCase())) ||
          (conv.phone &&
            conv.phone.toString().includes(searchTerm.toLowerCase()));

        const matchesStatus =
          statusFilter === "all" || conv.status === statusFilter;

        return matchesSearch && matchesStatus;
      }),
    [conversations, searchTerm, statusFilter]
  );

  const selectedConversation = useMemo(
    () =>
      conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  const groupMessagesByDay = useMemo(() => {
    const groups = {};
    messages.forEach((m) => {
      const d = m.timestamp ? new Date(m.timestamp) : new Date();
      const key = d.toISOString().slice(0, 10);
      if (!groups[key]) groups[key] = [];
      groups[key].push(m);
    });
    return Object.entries(groups).sort(([a], [b]) => (a < b ? -1 : 1));
  }, [messages]);

  // ============ AÇÕES ============

  const handleCloseConversation = async () => {
    if (!selectedConversationId) return;
    try {
      setClosing(true);
      await fetch(
        `${API_BASE}/conversations/${selectedConversationId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "closed" }),
        }
      );
      await loadConversations();
    } catch (err) {
      console.error("Erro ao fechar conversa:", err);
    } finally {
      setClosing(false);
    }
  };

  const handleSendMessage = async () => {
    if (!selectedConversationId || !newMessage.trim() || sending) return;

    const text = newMessage.trim();
    try {
      setSending(true);

      const res = await fetch(
        `${API_BASE}/conversations/${selectedConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        }
      );

      if (!res.ok) {
        console.error(
          "Erro HTTP ao enviar mensagem:",
          res.status,
          await res.text()
        );
      }

      setNewMessage("");
      await loadMessages(selectedConversationId);
      await loadConversations();
    } catch (err) {
      console.error("Erro ao enviar mensagem:", err);
    } finally {
      setSending(false);
    }
  };

  const handleComposerKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // ============ RENDER ============

  return (
    <div className="history-page">
      {/* SIDEBAR */}
      <aside className="history-sidebar">
        <div className="sidebar-header">
          <h2>Histórico de Chats</h2>
          <p className="sidebar-subtitle">
            Veja todas as conversas recebidas pela plataforma.
          </p>
        </div>

        <div className="sidebar-search">
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="sidebar-filters">
          <button
            className={
              statusFilter === "all" ? "filter-btn active" : "filter-btn"
            }
            onClick={() => setStatusFilter("all")}
          >
            Todos
          </button>
          <button
            className={
              statusFilter === "open" ? "filter-btn active" : "filter-btn"
            }
            onClick={() => setStatusFilter("open")}
          >
            Abertos
          </button>
          <button
            className={
              statusFilter === "closed" ? "filter-btn active" : "filter-btn"
            }
            onClick={() => setStatusFilter("closed")}
          >
            Fechados
          </button>
        </div>

        <div className="sidebar-list">
          {loadingConversations && (
            <div className="sidebar-empty">Carregando conversas...</div>
          )}

          {!loadingConversations && filteredConversations.length === 0 && (
            <div className="sidebar-empty">
              Nenhuma conversa encontrada com os filtros atuais.
            </div>
          )}

          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              className={
                conv.id === selectedConversationId
                  ? "conv-item conv-item-active"
                  : "conv-item"
              }
              onClick={() => setSelectedConversationId(conv.id)}
            >
              <div className="conv-avatar">
                {getInitials(conv.contactName, conv.phone)}
              </div>
              <div className="conv-main">
                <div className="conv-top-row">
                  <span className="conv-name">
                    {conv.contactName || "Sem nome"}
                  </span>
                </div>
                <div className="conv-bottom-row">
                  <span className="conv-phone">
                    {conv.phone || "Telefone não informado"}
                  </span>
                  <span
                    className={
                      "conv-status-badge " +
                      (conv.status === "closed"
                        ? "conv-status-closed"
                        : "conv-status-open")
                    }
                  >
                    {getStatusLabel(conv.status)}
                  </span>
                </div>
                {conv.updatedAt && (
                  <div className="conv-time-row">
                    <span className="conv-time">
                      {formatDateTime(conv.updatedAt)}
                    </span>
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* MAIN */}
      <section className="history-main">
        {!selectedConversation && (
          <div className="history-empty-state">
            <h3>Selecione uma conversa</h3>
            <p>
              Clique em uma conversa à esquerda para visualizar todo o histórico
              de mensagens.
            </p>
          </div>
        )}

        {selectedConversation && (
          <>
            <div className="history-header">
              <div>
                <h2>{selectedConversation.contactName || "Sem nome"}</h2>
                <p className="history-header-sub">
                  {selectedConversation.phone} •{" "}
                  {getStatusLabel(selectedConversation.status)}
                </p>
              </div>

              <div className="history-header-right">
                {selectedConversation.updatedAt && (
                  <span className="history-header-meta">
                    Última atualização:{" "}
                    {formatDateTime(selectedConversation.updatedAt)}
                  </span>
                )}
                <button
                  className="close-conv-btn"
                  onClick={handleCloseConversation}
                  disabled={closing}
                >
                  {selectedConversation.status === "closed"
                    ? closing
                      ? "Encerrando..."
                      : "Conversa encerrada"
                    : closing
                    ? "Encerrando..."
                    : "Encerrar sessão"}
                </button>
              </div>
            </div>

            <div className="history-body">
              <div className="history-messages">
                {loadingMessages && (
                  <div className="messages-loading">
                    Carregando mensagens...
                  </div>
                )}

                {!loadingMessages && messages.length === 0 && (
                  <div className="messages-empty">
                    Nenhuma mensagem encontrada nesta conversa.
                  </div>
                )}

                {!loadingMessages &&
                  groupMessagesByDay.map(([day, msgs]) => {
                    const d = new Date(day);
                    const label = d.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                      year: "2-digit",
                    });

                    return (
                      <div key={day} className="day-group">
                        <div className="day-separator">
                          <span>{label}</span>
                        </div>
                        {msgs.map((msg) => {
                          const isOutgoing =
                            msg.direction === "out" ||
                            msg.from === "me" ||
                            msg.from === "system";

                          return (
                            <div
                              key={msg.id || msg.timestamp}
                              className={
                                "msg-row " +
                                (isOutgoing
                                  ? "msg-row-outgoing"
                                  : "msg-row-incoming")
                              }
                            >
                              <div
                                className={
                                  "msg-bubble " +
                                  (isOutgoing
                                    ? "msg-bubble-outgoing"
                                    : "msg-bubble-incoming")
                                }
                              >
                                <div className="msg-body">
                                  {/* ✏️ TEXTO (sempre que existir) */}
                                  {(msg.text || msg.body) && (
                                    <p className="msg-text">
                                      {msg.text || msg.body}
                                    </p>
                                  )}

                                  {/* 📸 IMAGEM */}
                                  {msg.type === "image" &&
                                    msg.mediaUrl && (
                                      <img
                                        src={msg.mediaUrl}
                                        alt="imagem recebida"
                                        className="msg-image"
                                      />
                                    )}
                                  {msg.type === "image" &&
                                    !msg.mediaUrl && (
                                      <span className="msg-placeholder">
                                        📷 Imagem recebida
                                      </span>
                                    )}

                                  {/* 🎬 VÍDEO / GIF */}
                                  {msg.type === "video" &&
                                    msg.mediaUrl && (
                                      <video
                                        src={msg.mediaUrl}
                                        controls
                                        className="msg-video"
                                      />
                                    )}
                                  {msg.type === "video" &&
                                    !msg.mediaUrl && (
                                      <span className="msg-placeholder">
                                        🎥 Vídeo recebido
                                      </span>
                                    )}

                                  {/* 🎧 ÁUDIO */}
                                  {msg.type === "audio" &&
                                    msg.mediaUrl && (
                                      <audio
                                        src={msg.mediaUrl}
                                        controls
                                        className="msg-audio"
                                      />
                                    )}
                                  {msg.type === "audio" &&
                                    !msg.mediaUrl && (
                                      <span className="msg-placeholder">
                                        🎧 Áudio recebido
                                      </span>
                                    )}

                                  {/* 📄 DOCUMENTO / PDF */}
                                  {msg.type === "document" &&
                                    msg.mediaUrl && (
                                      <a
                                        href={msg.mediaUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="msg-document"
                                      >
                                        📄 Abrir documento
                                      </a>
                                    )}
                                  {msg.type === "document" &&
                                    !msg.mediaUrl && (
                                      <span className="msg-placeholder">
                                        📄 Documento recebido
                                      </span>
                                    )}

                                  {/* 🌟 FIGURINHA (WEBP) */}
                                  {msg.type === "sticker" &&
                                    msg.mediaUrl && (
                                      <img
                                        src={msg.mediaUrl}
                                        alt="figurinha"
                                        className="msg-sticker"
                                      />
                                    )}
                                  {msg.type === "sticker" &&
                                    !msg.mediaUrl && (
                                      <span className="msg-placeholder">
                                        🌟 Figurinha recebida
                                      </span>
                                    )}

                                  {/* Fallback geral */}
                                  {!msg.text &&
                                    !msg.body &&
                                    !msg.mediaUrl &&
                                    !msg.type && (
                                      <span className="msg-placeholder">
                                        (sem conteúdo)
                                      </span>
                                    )}
                                </div>

                                <div className="msg-meta">
                                  {formatDateTime(msg.timestamp)}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>

              <div className="history-composer">
                <textarea
                  rows={1}
                  placeholder="Digite uma mensagem..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={handleComposerKeyDown}
                />
                <button
                  className="send-btn"
                  onClick={handleSendMessage}
                  disabled={
                    sending ||
                    !newMessage.trim() ||
                    !selectedConversationId
                  }
                >
                  {sending ? "Enviando..." : "Enviar"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
