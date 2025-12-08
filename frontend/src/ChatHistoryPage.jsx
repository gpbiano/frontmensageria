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
  updateConversationStatus,
  updateConversationNotes
} from "./api";
import ChatPanel from "./components/ChatPanel.jsx";

const NOTIF_KEY = "gpLabsNotificationSettings";
const QUIET_START_HOUR = 22; // 22h
const QUIET_END_HOUR = 7; // 07h

export default function ChatHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] =
    useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] =
    useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("open"); // Abertas por padrão

  // contador de mensagens não lidas por conversa { [id]: number }
  const [unreadCounts, setUnreadCounts] = useState({});

  const prevOpenConversationsCount = useRef(0);
  const prevConversationsMapRef = useRef(new Map());

  // alerta visual para respostas do bot (no topo da página)
  const [botAlert, setBotAlert] = useState(false);
  const lastBotMessageIdRef = useRef(null);

  // estado da aba do navegador (ativa/inativa)
  const [isTabActive, setIsTabActive] = useState(!document.hidden);

  // rastrear atividade do atendente (para detectar inatividade)
  const lastActivityRef = useRef(Date.now());

  // configurações de notificação
  const [notificationsEnabled, setNotificationsEnabled] =
    useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  // notas do atendente (sessão atual)
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // modal de histórico de chats anteriores
  const [historyModal, setHistoryModal] = useState({
    open: false,
    loading: false,
    title: "",
    messages: []
  });

  // ---------------------------------------------
  // HELPERS – HORÁRIO SILENCIOSO / NOTIFICAÇÕES
  // ---------------------------------------------
  function isWithinQuietHours() {
    if (!quietHoursEnabled) return false;
    const hour = new Date().getHours();

    // faixa que passa da meia-noite (ex: 22h–7h)
    if (QUIET_START_HOUR > QUIET_END_HOUR) {
      return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
    }

    // faixa "normal" (não cruza meia-noite)
    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  }

  function playNotification(
    type,
    { intensity = "soft", force = false } = {}
  ) {
    if (!notificationsEnabled && !force) return;
    if (!force && isWithinQuietHours()) return;

    let file = null;
    if (type === "new-chat") file = "/new-chat.mp3";
    if (type === "received") file = "/received.mp3";

    if (!file) return;

    try {
      const audio = new Audio(file);
      audio.volume = intensity === "strong" ? 1 : 0.45;
      audio.play().catch(() => {});
    } catch (e) {
      console.warn("Não foi possível tocar som:", e);
    }
  }

  function getIdleInfo() {
    const now = Date.now();
    const idleMs = now - lastActivityRef.current;
    const isIdle = idleMs > 60_000; // 1 minuto
    return { idleMs, isIdle };
  }

  // ---------------------------------------------
  // BOOT – CARREGAR CONFIG DE NOTIFICAÇÃO
  // ---------------------------------------------
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.notificationsEnabled === "boolean") {
        setNotificationsEnabled(parsed.notificationsEnabled);
      }
      if (typeof parsed.quietHoursEnabled === "boolean") {
        setQuietHoursEnabled(parsed.quietHoursEnabled);
      }
    } catch (e) {
      console.warn(
        "Não foi possível carregar config de notificações:",
        e
      );
    }
  }, []);

  useEffect(() => {
    try {
      const payload = JSON.stringify({
        notificationsEnabled,
        quietHoursEnabled
      });
      localStorage.setItem(NOTIF_KEY, payload);
    } catch (e) {
      console.warn(
        "Não foi possível salvar config de notificações:",
        e
      );
    }
  }, [notificationsEnabled, quietHoursEnabled]);

  // ---------------------------------------------
  // TRACKER – VISIBILIDADE DA ABA + ATIVIDADE
  // ---------------------------------------------
  useEffect(() => {
    function handleVisibilityChange() {
      setIsTabActive(!document.hidden);
    }

    function markActivity() {
      lastActivityRef.current = Date.now();
    }

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange
    );
    window.addEventListener("mousemove", markActivity);
    window.addEventListener("keydown", markActivity);
    window.addEventListener("click", markActivity);
    window.addEventListener("scroll", markActivity);

    return () => {
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange
      );
      window.removeEventListener("mousemove", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("click", markActivity);
      window.removeEventListener("scroll", markActivity);
    };
  }, []);

  // ---------------------------------------------
  // LOAD CONVERSAS
  // ---------------------------------------------
  const loadConversations = useCallback(
    async (options = { playSoundOnNew: false }) => {
      try {
        setLoadingConversations(
          (prev) => prev && !options.playSoundOnNew
        );

        const data = await fetchConversations(statusFilter);
        const list = Array.isArray(data) ? data : [];

        // detectar novos chats / atualizações em outras conversas
        const prevMap = prevConversationsMapRef.current;
        const newMap = new Map();

        let newChatDetected = false;
        let otherConversationUpdated = false;

        for (const conv of list) {
          const prevUpdatedAt = prevMap.get(conv.id);
          const currentUpdatedAt = conv.updatedAt || null;

          if (prevUpdatedAt == null && prevMap.size > 0) {
            // conversa nova
            newChatDetected = true;
          } else if (
            prevUpdatedAt &&
            currentUpdatedAt &&
            new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
            conv.id !== selectedConversationId
          ) {
            // conversa antiga recebeu nova mensagem (não selecionada)
            otherConversationUpdated = true;
          }

          newMap.set(conv.id, currentUpdatedAt);
        }

        prevConversationsMapRef.current = newMap;

        // recalcular contadores de não lidas
        setUnreadCounts((prev) => {
          const next = { ...prev };

          // limpar ids que não existem mais
          const idsSet = new Set(list.map((c) => c.id));
          Object.keys(next).forEach((idStr) => {
            const idNum = Number(idStr);
            if (!idsSet.has(idNum)) {
              delete next[idStr];
            }
          });

          for (const conv of list) {
            const prevUpdatedAt = prevMap.get(conv.id);
            const currentUpdatedAt = conv.updatedAt || null;

            const isNewConv =
              prevUpdatedAt == null && prevMap.size > 0;
            const isUpdatedOtherConv =
              prevUpdatedAt &&
              currentUpdatedAt &&
              new Date(currentUpdatedAt) >
                new Date(prevUpdatedAt) &&
              conv.id !== selectedConversationId;

            if (isNewConv || isUpdatedOtherConv) {
              next[conv.id] = (next[conv.id] || 0) + 1;
            }

            // conversa selecionada sempre zera contador
            if (conv.id === selectedConversationId) {
              next[conv.id] = 0;
            }
          }

          return next;
        });

        // alerta de novo chat (quando filtro é "Abertas")
        if (options.playSoundOnNew && statusFilter === "open") {
          const openNow = list.length;
          const prevOpen = prevOpenConversationsCount.current;

          if (prevOpen && openNow > prevOpen) {
            newChatDetected = true;
          }
          prevOpenConversationsCount.current = openNow;
        } else {
          prevOpenConversationsCount.current = list.length;
        }

        // NOTIFICAÇÃO – NOVO CHAT
        if (newChatDetected) {
          const { isIdle } = getIdleInfo();
          const intensity =
            !isTabActive || isIdle ? "strong" : "soft";
          playNotification("new-chat", { intensity });
        }

        // NOTIFICAÇÃO – MENSAGEM EM OUTRA CONVERSA
        if (otherConversationUpdated) {
          const { isIdle } = getIdleInfo();
          const intensity =
            !isTabActive || isIdle ? "strong" : "soft";
          playNotification("received", { intensity });
        }

        setConversations(list);

        // se nada selecionado, escolhe a primeira
        if (!selectedConversationId && list.length > 0) {
          setSelectedConversationId(list[0].id);
        }

        // se a conversa atual saiu do filtro, ajusta seleção
        if (selectedConversationId) {
          const stillExists = list.some(
            (c) => c.id === selectedConversationId
          );
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
    [selectedConversationId, statusFilter, isTabActive]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // polling para detectar novos chats / atualizações
  useEffect(() => {
    const interval = setInterval(
      () => loadConversations({ playSoundOnNew: true }),
      5000
    );
    return () => clearInterval(interval);
  }, [loadConversations]);

  // ---------------------------------------------
  // LOAD MENSAGENS DA CONVERSA ATUAL
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

  // polling da conversa atual
  useEffect(() => {
    if (!selectedConversationId) return;
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedConversationId, loadMessages]);

  // ---------------------------------------------
  // ALERTA VISUAL PARA RESPOSTA DO BOT (SEM SOM)
  // ---------------------------------------------
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const botMessages = messages.filter(
      (m) => m.isBot || m.fromBot
    );
    if (botMessages.length === 0) return;

    const lastBotMsg = botMessages[botMessages.length - 1];

    if (lastBotMessageIdRef.current === lastBotMsg.id) return;
    lastBotMessageIdRef.current = lastBotMsg.id;

    setBotAlert(true);
    const timeout = setTimeout(() => setBotAlert(false), 4000);
    return () => clearTimeout(timeout);
  }, [messages]);

  // ---------------------------------------------
  // ALERTA SONORO – MENSAGEM RECEBIDA NA CONVERSA ATUAL
  // ---------------------------------------------
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (!last) return;

    // Som apenas para mensagem vinda do cliente (inbound)
    if (last.direction === "in" && !last.isBot && !last.fromBot) {
      const { isIdle } = getIdleInfo();

      if (isTabActive && !isIdle) {
        // operador olhando a aba e ativo → não precisa som
        return;
      }

      const intensity =
        !isTabActive && isIdle ? "strong" : "soft";

      playNotification("received", { intensity });
    }
  }, [messages, isTabActive]);

  // ---------------------------------------------
  // AÇÕES
  // ---------------------------------------------
  const handleSelectConversation = (id) => {
    setSelectedConversationId(id);
    setMessages([]);

    // zera contador de não lidas ao abrir
    setUnreadCounts((prev) => ({
      ...prev,
      [id]: 0
    }));
  };

  const handleSendText = async (text) => {
    if (!selectedConversationId || !text.trim()) return;
    const created = await sendTextMessage(
      selectedConversationId,
      text.trim()
    );
    setMessages((prev) => [...prev, created]);

    // som de envio (sempre local, feedback rápido)
    try {
      const audio = new Audio("/send.mp3");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  const handleSendMedia = async ({ type, mediaUrl, caption }) => {
    if (!selectedConversationId || !mediaUrl) return;
    const created = await sendMediaMessage(selectedConversationId, {
      type,
      mediaUrl,
      caption
    });
    setMessages((prev) => [...prev, created]);

    // som de envio
    try {
      const audio = new Audio("/send.mp3");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  const handleChangeStatus = async (
    conversationId,
    newStatus,
    extraData
  ) => {
    try {
      const updated = await updateConversationStatus(
        conversationId,
        newStatus,
        extraData
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

  const handleSaveNotes = async () => {
    if (!selectedConversationId) return;
    try {
      setSavingNotes(true);
      const updated = await updateConversationNotes(
        selectedConversationId,
        notesDraft
      );

      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );
    } catch (err) {
      console.error("Erro ao salvar observação:", err);
    } finally {
      setSavingNotes(false);
    }
  };

  const handleOpenPreviousSession = async (sessionConv) => {
    try {
      setHistoryModal({
        open: true,
        loading: true,
        title:
          sessionConv.createdAt || sessionConv.updatedAt || "",
        messages: []
      });

      const data = await fetchMessages(sessionConv.id);

      setHistoryModal((prev) => ({
        ...prev,
        loading: false,
        messages: Array.isArray(data) ? data : []
      }));
    } catch (err) {
      console.error("Erro ao carregar histórico:", err);
      setHistoryModal((prev) => ({ ...prev, loading: false }));
    }
  };

  const handleCloseHistoryModal = () => {
    setHistoryModal({
      open: false,
      loading: false,
      title: "",
      messages: []
    });
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
      conversations.find((c) => c.id === selectedConversationId) ||
      null,
    [conversations, selectedConversationId]
  );

  // quando troca de conversa, sincronizar notas
  useEffect(() => {
    if (selectedConversation) {
      setNotesDraft(selectedConversation.notes || "");
    } else {
      setNotesDraft("");
    }
  }, [selectedConversation]);

  // chats anteriores: todas as outras conversas do mesmo telefone
  const previousSessions = useMemo(() => {
    if (!selectedConversation) return [];
    return conversations
      .filter(
        (c) =>
          c.phone === selectedConversation.phone &&
          c.id !== selectedConversation.id
      )
      .sort((a, b) => {
        const da = new Date(a.updatedAt || a.createdAt || 0);
        const db = new Date(b.updatedAt || b.createdAt || 0);
        return db - da;
      });
  }, [conversations, selectedConversation]);

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------
  return (
    <>
      <div
        className={
          "chat-history-layout" + (botAlert ? " bot-alert" : "")
        }
      >
        {/* COLUNA ESQUERDA – CONVERSAS */}
        <aside className="chat-history-sidebar">
          <div className="chat-history-header">
            <div>
              <h1>Conversas</h1>
              <p>Atendimentos em tempo real</p>
            </div>

            <div className="chat-history-notification-controls">
              <label className="notif-toggle">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(e) =>
                    setNotificationsEnabled(e.target.checked)
                  }
                />
                <span>🔊 Som</span>
              </label>
              <label className="notif-toggle">
                <input
                  type="checkbox"
                  checked={quietHoursEnabled}
                  onChange={(e) =>
                    setQuietHoursEnabled(e.target.checked)
                  }
                />
                <span>🔕 Silêncio</span>
              </label>
            </div>
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

            {filteredConversations.map((conv) => {
              const unread = unreadCounts[conv.id] || 0;

              // canal: whatsapp / instagram / facebook / web
              let channelIcon = null;
              if (conv.channel === "whatsapp") {
                channelIcon = "/channels/whatsapp.svg";
              } else if (conv.channel === "instagram") {
                channelIcon = "/channels/instagram.svg";
              } else if (conv.channel === "facebook") {
                channelIcon = "/channels/facebook.svg";
              } else if (conv.channel === "web") {
                channelIcon = "/channels/web.svg";
              }

              return (
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

                    {channelIcon && (
                      <img
                        src={channelIcon}
                        alt={conv.channel}
                        className="chat-channel-icon"
                      />
                    )}

                    <span className="chat-history-status">
                      {conv.status === "open"
                        ? "Aberta"
                        : "Encerrada"}
                    </span>

                    {unread > 0 && (
                      <span className="chat-history-unread-badge">
                        {unread}
                      </span>
                    )}
                  </div>
                  <div className="chat-history-phone">
                    {conv.phone}
                  </div>
                  <div className="chat-history-last-message">
                    {conv.lastMessage || "Sem mensagens ainda"}
                  </div>
                </button>
              );
            })}
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
                  <div className="chat-contact-channel">
                    <span>Canal de origem:</span>
                    {selectedConversation.channel && (
                      <>
                        {selectedConversation.channel}
                      </>
                    )}
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
                    Tags da sessão
                  </div>
                  <div className="chat-contact-value">
                    {selectedConversation.tags &&
                    selectedConversation.tags.length > 0
                      ? selectedConversation.tags.join(", ")
                      : "Nenhuma tag aplicada."}
                  </div>
                </div>

                <div className="chat-contact-section">
                  <div className="chat-contact-label">
                    Observações do atendente
                  </div>
                  <textarea
                    className="chat-contact-notes-input"
                    placeholder="Escreva uma anotação sobre este atendimento..."
                    value={notesDraft}
                    onChange={(e) =>
                      setNotesDraft(e.target.value)
                    }
                  />
                  <button
                    className="chat-save-notes-button"
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                  >
                    {savingNotes
                      ? "Salvando..."
                      : "Salvar observação"}
                  </button>
                </div>

                <div className="chat-contact-section">
                  <div className="chat-contact-label">
                    Chats anteriores
                  </div>
                  {previousSessions.length === 0 ? (
                    <div className="chat-contact-value">
                      Nenhuma sessão anterior para este contato.
                    </div>
                  ) : (
                    <ul className="chat-previous-sessions-list">
                      {previousSessions.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            className="chat-previous-session-item"
                            onClick={() =>
                              handleOpenPreviousSession(s)
                            }
                          >
                            <span>
                              {new Date(
                                s.createdAt || s.updatedAt
                              ).toLocaleString()}
                            </span>
                            <span className="chat-previous-session-status">
                              {s.status === "open"
                                ? "Aberta"
                                : "Encerrada"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </aside>
            </div>
          ) : (
            <div className="chat-history-placeholder">
              <h2>Sem conversa selecionada</h2>
              <p>
                Escolha uma conversa na coluna à esquerda para
                iniciar o atendimento. Novos chats aparecerão
                automaticamente quando chegarem.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* MODAL DE CHAT ANTERIOR (somente leitura) */}
      {historyModal.open && (
        <div className="chat-history-modal-backdrop">
          <div className="chat-history-modal">
            <div className="chat-history-modal-header">
              <h3>Chat anterior</h3>
              <button onClick={handleCloseHistoryModal}>
                Fechar
              </button>
            </div>
            <div className="chat-history-modal-subtitle">
              {historyModal.title &&
                new Date(historyModal.title).toLocaleString()}
            </div>
            <div className="chat-history-modal-body">
              {historyModal.loading ? (
                <p>Carregando mensagens...</p>
              ) : historyModal.messages.length === 0 ? (
                <p>Sem mensagens nesta sessão.</p>
              ) : (
                <div className="chat-history-modal-messages">
                  {historyModal.messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={
                        "message-row " +
                        (msg.direction === "in"
                          ? "message-row-in"
                          : "message-row-out")
                      }
                    >
                      <div
                        className={
                          msg.direction === "in"
                            ? "message-bubble-in"
                            : "message-bubble-out"
                        }
                      >
                        <div className="chat-message-text">
                          {msg.text ||
                            msg.body ||
                            "[mensagem sem texto]"}
                        </div>
                        <div className="message-timestamp">
                          {msg.timestamp
                            ? new Date(
                                msg.timestamp
                              ).toLocaleString()
                            : ""}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

