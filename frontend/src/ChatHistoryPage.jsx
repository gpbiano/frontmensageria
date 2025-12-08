// frontend/src/ChatHistoryPage.jsx
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import {
  fetchConversations,
  fetchMessages,
  sendTextMessage,
  sendMediaMessage,
  updateConversationStatus
} from "./api";
import ChatPanel from "./components/ChatPanel.jsx";

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("open"); // Abertas por padrão

  const prevOpenConversationsCount = useRef(0);

  // ---------------------------------------------
  // LOAD CONVERSAS
  // ---------------------------------------------
  const loadConversations = useCallback(
    async (options = { playSoundOnNew: false }) => {
      try {
        setLoadingConversations((prev) => prev && !options.playSoundOnNew);

        const data = await fetchConversations(statusFilter);
        const list = Array.isArray(data) ? data : [];

        // alerta de novo chat (quando filtro é "Abertas")
        if (options.playSoundOnNew && statusFilter === "open") {
          const openNow = list.length;
          if (
            prevOpenConversationsCount.current &&
            openNow > prevOpenConversationsCount.current
          ) {
            try {
              const audio = new Audio("/new-chat.mp3"); // coloque esse arquivo em /public se quiser som
              audio.play().catch(() => {});
            } catch (e) {
              console.warn("Não foi possível tocar o som de novo chat.");
            }
          }
          prevOpenConversationsCount.current = openNow;
        } else {
          prevOpenConversationsCount.current = list.length;
        }

        setConversations(list);

        // se nada selecionado, escolhe a primeira
        if (!selectedConversationId && list.length > 0) {
          setSelectedConversationId(list[0].id);
        }

        // se a conversa atual saiu do filtro, ajusta seleção
        if (selectedConversationId) {
          const stillExists = list.some((c) => c.id === selectedConversationId);
          if (!stillExists) {
            setSelectedConversationId(list[0]?.id || null);
            setMessages([]);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar conversas:", err);
      } finally {
        setLoadingConversations(false);
      }
    },
    [selectedConversationId, statusFilter]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // polling para detectar novos chats
  useEffect(() => {
    const interval = setInterval(
      () => loadConversations({ playSoundOnNew: true }),
      5000
    );
    return () => clearInterval(interval);
  }, [loadConversations]);

  // ---------------------------------------------
  // LOAD MENSAGENS
  // ---------------------------------------------
  const loadMessages = useCallback(async () => {
    if (!selectedConversationId) return;
    try {
      setLoadingMessages(true);
      const data = await fetchMessages(selectedConversationId);
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // polling de mensagens da conversa atual
  useEffect(() => {
    if (!selectedConversationId) return;
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedConversationId, loadMessages]);

  // ---------------------------------------------
  // AÇÕES
  // ---------------------------------------------
  const handleSelectConversation = (id) => {
    setSelectedConversationId(id);
    setMessages([]);
  };

  const handleSendText = async (text) => {
    if (!selectedConversationId || !text.trim()) return;
    const created = await sendTextMessage(selectedConversationId, text.trim());
    setMessages((prev) => [...prev, created]);
  };

  const handleSendMedia = async ({ type, mediaUrl, caption }) => {
    if (!selectedConversationId || !mediaUrl) return;
    const created = await sendMediaMessage(selectedConversationId, {
      type,
      mediaUrl,
      caption
    });
    setMessages((prev) => [...prev, created]);
  };

  const handleChangeStatus = async (conversationId, newStatus) => {
    try {
      const updated = await updateConversationStatus(
        conversationId,
        newStatus
      );

      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );

      // se fechou e filtro está em abertas, some da lista
      if (statusFilter === "open" && newStatus === "closed") {
        setConversations((prev) =>
          prev.filter((c) => c.id !== conversationId)
        );
        if (selectedConversationId === conversationId) {
          setSelectedConversationId(null);
          setMessages([]);
        }
      }
    } catch (err) {
      console.error("Erro ao alterar status:", err);
    }
  };

  // ---------------------------------------------
  // LISTAS DERIVADAS
  // ---------------------------------------------
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      const matchesTerm =
        !term ||
        (c.contactName &&
          c.contactName.toLowerCase().includes(term)) ||
        (c.phone && c.phone.toLowerCase().includes(term)) ||
        (c.lastMessage &&
          c.lastMessage.toLowerCase().includes(term));

      return matchesTerm;
    });
  }, [conversations, searchTerm]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------
  return (
    <div className="chat-history-layout">
      {/* COLUNA ESQUERDA – CONVERSAS */}
      <aside className="chat-history-sidebar">
        <div className="chat-history-header">
          <h1>Conversas</h1>
          <p>Atendimentos em tempo real</p>
        </div>

        <div className="chat-history-search">
          <input
            placeholder="Buscar por nome, telefone ou mensagem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="chat-history-filters">
          <button
            className={statusFilter === "open" ? "active" : ""}
            onClick={() => setStatusFilter("open")}
          >
            Abertas
          </button>
          <button
            className={statusFilter === "closed" ? "active" : ""}
            onClick={() => setStatusFilter("closed")}
          >
            Encerradas
          </button>
          <button
            className={statusFilter === "all" ? "active" : ""}
            onClick={() => setStatusFilter("all")}
          >
            Todas
          </button>
        </div>

        <div className="chat-history-list">
          {loadingConversations && (
            <div className="chat-history-empty">
              Carregando conversas...
            </div>
          )}

          {!loadingConversations &&
            filteredConversations.length === 0 && (
              <div className="chat-history-empty">
                Nenhuma conversa encontrada.
              </div>
            )}

          {filteredConversations.map((conv) => (
            <button
              key={conv.id}
              className={
                "chat-history-item" +
                (conv.id === selectedConversationId
                  ? " selected"
                  : "")
              }
              onClick={() => handleSelectConversation(conv.id)}
            >
              <div className="chat-history-item-main">
                <span className="chat-history-contact-name">
                  {conv.contactName || conv.phone}
                </span>
                <span className="chat-history-status">
                  {conv.status === "open" ? "Aberta" : "Encerrada"}
                </span>
              </div>
              <div className="chat-history-phone">
                {conv.phone}
              </div>
              <div className="chat-history-last-message">
                {conv.lastMessage || "Sem mensagens ainda"}
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* COLUNA CENTRAL + DIREITA */}
      <section className="chat-history-main">
        {selectedConversation ? (
          <div
            style={{
              display: "flex",
              flex: 1,
              minHeight: 0
            }}
          >
            {/* CHAT (CENTRO) */}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                height: "100%"
              }}
            >
              <ChatPanel
                conversation={selectedConversation}
                messages={messages}
                loadingMessages={loadingMessages}
                onSendText={handleSendText}
                onSendMedia={handleSendMedia}
                onChangeStatus={handleChangeStatus}
              />
            </div>

            {/* PAINEL DE CONTATO (DIREITA) */}
            <aside className="chat-contact-panel">
              <div className="chat-contact-section">
                <div className="chat-contact-label">
                  Informações do contato
                </div>
                <div className="chat-contact-name">
                  {selectedConversation.contactName || "Sem nome"}
                </div>
                <div className="chat-contact-phone">
                  {selectedConversation.phone}
                </div>
              </div>

              <div className="chat-contact-section">
                <div className="chat-contact-label">
                  Última atualização
                </div>
                <div className="chat-contact-value">
                  {selectedConversation.updatedAt
                    ? new Date(
                        selectedConversation.updatedAt
                      ).toLocaleString()
                    : "—"}
                </div>
              </div>

              <div className="chat-contact-section">
                <div className="chat-contact-label">
                  Tags / Observações
                </div>
                <div className="chat-contact-value">
                  Nenhuma tag cadastrada.
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="chat-history-placeholder">
            <h2>Sem conversa selecionada</h2>
            <p>
              Escolha uma conversa na coluna à esquerda para iniciar
              o atendimento. Novos chats aparecerão automaticamente
              quando chegarem.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
