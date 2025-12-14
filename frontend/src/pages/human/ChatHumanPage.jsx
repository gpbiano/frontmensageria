// frontend/src/pages/ChatHumanHistoryPage.jsx
import "../../styles/chat-human.css";

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
} from "../../api.js";
import ChatPanel from "../../components/ChatPanel.jsx";

const NOTIF_KEY = "gpLabsNotificationSettings";
const QUIET_START_HOUR = 22; // 22h
const QUIET_END_HOUR = 7; // 07h

function normalizeChannel(conv) {
  const raw = String(conv?.source || conv?.channel || "").toLowerCase();
  if (raw.includes("webchat")) return "webchat";
  if (raw.includes("whatsapp")) return "whatsapp";
  if (raw.includes("wa")) return "whatsapp";
  if (raw.includes("wc")) return "webchat";
  return raw || "whatsapp";
}

function channelLabel(ch) {
  if (ch === "webchat") return "Webchat";
  if (ch === "whatsapp") return "WhatsApp";
  return ch ? ch : "Canal";
}

export default function ChatHumanHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // Histórico → todas por padrão
  const [channelFilter, setChannelFilter] = useState("all"); // ✅ Todos | whatsapp | webchat

  const [unreadCounts, setUnreadCounts] = useState({});

  const prevOpenConversationsCount = useRef(0);
  const prevConversationsMapRef = useRef(new Map());

  const [botAlert, setBotAlert] = useState(false);
  const lastBotMessageIdRef = useRef(null);

  const [isTabActive, setIsTabActive] = useState(!document.hidden);
  const lastActivityRef = useRef(Date.now());

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  // ---------------------------------------------
  // HELPERS – HORÁRIO SILENCIOSO / NOTIFICAÇÕES
  // ---------------------------------------------
  function isWithinQuietHours() {
    if (!quietHoursEnabled) return false;
    const hour = new Date().getHours();

    if (QUIET_START_HOUR > QUIET_END_HOUR) {
      return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
    }

    return hour >= QUIET_START_HOUR && hour < QUIET_END_HOUR;
  }

  function playNotification(type, { intensity = "soft", force = false } = {}) {
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
      console.warn("Não foi possível carregar config de notificações:", e);
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
      console.warn("Não foi possível salvar config de notificações:", e);
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

    document.addEventListener("visibilitychange", handleVisibilityChange);
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
  // LOAD CONVERSAS (HISTÓRICO HUMANO)
  // ---------------------------------------------
  const loadConversations = useCallback(
    async (options = { playSoundOnNew: false }) => {
      try {
        setLoadingConversations((prev) => prev && !options.playSoundOnNew);

        const data = await fetchConversations("all");
        const list = Array.isArray(data) ? data : [];

        const prevMap = prevConversationsMapRef.current;
        const newMap = new Map();

        let otherConversationUpdated = false;

        for (const conv of list) {
          const prevUpdatedAt = prevMap.get(conv.id);
          const currentUpdatedAt = conv.updatedAt || null;

          if (
            prevUpdatedAt &&
            currentUpdatedAt &&
            new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
            conv.id !== selectedConversationId
          ) {
            otherConversationUpdated = true;
          }

          newMap.set(conv.id, currentUpdatedAt);
        }

        prevConversationsMapRef.current = newMap;

        setUnreadCounts((prev) => {
          const next = { ...prev };
          const idsSet = new Set(list.map((c) => String(c.id)));

          // ✅ correção: ids no state são strings
          Object.keys(next).forEach((idStr) => {
            if (!idsSet.has(String(idStr))) {
              delete next[idStr];
            }
          });

          for (const conv of list) {
            const prevUpdatedAt = prevMap.get(conv.id);
            const currentUpdatedAt = conv.updatedAt || null;

            const isUpdatedOtherConv =
              prevUpdatedAt &&
              currentUpdatedAt &&
              new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
              conv.id !== selectedConversationId;

            if (isUpdatedOtherConv) {
              next[String(conv.id)] = (next[String(conv.id)] || 0) + 1;
            }

            if (conv.id === selectedConversationId) {
              next[String(conv.id)] = 0;
            }
          }

          return next;
        });

        if (otherConversationUpdated) {
          const { isIdle } = getIdleInfo();
          const intensity = !isTabActive || isIdle ? "strong" : "soft";
          playNotification("received", { intensity });
        }

        setConversations(list);

        if (!selectedConversationId && list.length > 0) {
          setSelectedConversationId(list[0].id);
        }

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
    [selectedConversationId, isTabActive]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const interval = setInterval(
      () => loadConversations({ playSoundOnNew: false }),
      8000
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

  useEffect(() => {
    if (!selectedConversationId) return;
    const interval = setInterval(loadMessages, 4000);
    return () => clearInterval(interval);
  }, [selectedConversationId, loadMessages]);

  // ---------------------------------------------
  // ALERTA VISUAL BOT + SOM MENSAGEM ATUAL
  // ---------------------------------------------
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const botMessages = messages.filter((m) => m.isBot || m.fromBot);
    if (botMessages.length === 0) return;

    const lastBotMsg = botMessages[botMessages.length - 1];

    if (lastBotMessageIdRef.current === lastBotMsg.id) return;
    lastBotMessageIdRef.current = lastBotMsg.id;

    setBotAlert(true);
    const timeout = setTimeout(() => setBotAlert(false), 4000);
    return () => clearTimeout(timeout);
  }, [messages]);

  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (!last) return;

    if (last.direction === "in" && !last.isBot && !last.fromBot) {
      const { isIdle } = getIdleInfo();

      if (isTabActive && !isIdle) {
        return;
      }

      const intensity = !isTabActive && isIdle ? "strong" : "soft";
      playNotification("received", { intensity });
    }
  }, [messages, isTabActive]);

  // ---------------------------------------------
  // AÇÕES
  // ---------------------------------------------
  const handleSelectConversation = (id) => {
    setSelectedConversationId(id);
    setMessages([]);
    setUnreadCounts((prev) => ({
      ...prev,
      [String(id)]: 0
    }));
  };

  const handleSendText = async (text) => {
    if (!selectedConversationId || !text.trim()) return;
    const created = await sendTextMessage(selectedConversationId, text.trim());
    setMessages((prev) => [...prev, created]);

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

    try {
      const audio = new Audio("/send.mp3");
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (e) {}
  };

  const handleChangeStatus = async (conversationId, newStatus) => {
    try {
      const updated = await updateConversationStatus(conversationId, newStatus);

      setConversations((prev) =>
        prev.map((c) => (c.id === updated.id ? updated : c))
      );

      if (statusFilter === "open" && newStatus === "closed") {
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
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
  // LISTAS DERIVADAS – regra HUMANO + filtro de CANAL
  // ---------------------------------------------
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      // Apenas histórico humano:
      const isHumanConversation =
        c.currentMode === "human" || c.status === "closed";
      if (!isHumanConversation) return false;

      if (statusFilter !== "all" && c.status !== statusFilter) {
        return false;
      }

      // ✅ filtro por canal (Modelo A)
      const ch = normalizeChannel(c);
      if (channelFilter !== "all" && ch !== channelFilter) {
        return false;
      }

      const matchesTerm =
        !term ||
        (c.contactName && c.contactName.toLowerCase().includes(term)) ||
        (c.phone && String(c.phone).toLowerCase().includes(term)) ||
        (c.lastMessage && String(c.lastMessage).toLowerCase().includes(term)) ||
        (c.lastMessagePreview &&
          String(c.lastMessagePreview).toLowerCase().includes(term));

      return matchesTerm;
    });
  }, [conversations, searchTerm, statusFilter, channelFilter]);

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedConversationId) || null,
    [conversations, selectedConversationId]
  );

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------
  return (
    <div className={"chat-history-layout" + (botAlert ? " bot-alert" : "")}>
      {/* COLUNA ESQUERDA – LISTA DE ATENDIMENTOS HUMANOS */}
      <aside className="chat-history-sidebar">
        <div className="chat-history-header">
          <div>
            <h1>Histórico de Atendimentos Humanos</h1>
            <p>Conversas atendidas por operadores, abertas ou encerradas.</p>
          </div>
        </div>

        {/* Filtros de status */}
        <div className="chat-history-filters">
          <button
            className={statusFilter === "all" ? "active" : ""}
            onClick={() => setStatusFilter("all")}
          >
            Todas
          </button>
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
        </div>

        {/* ✅ Filtros de canal */}
        <div className="chat-history-filters" style={{ marginTop: 10 }}>
          <button
            className={channelFilter === "all" ? "active" : ""}
            onClick={() => setChannelFilter("all")}
            title="Mostrar todos os canais"
          >
            Todos
          </button>
          <button
            className={channelFilter === "whatsapp" ? "active" : ""}
            onClick={() => setChannelFilter("whatsapp")}
            title="Mostrar apenas WhatsApp"
          >
            WhatsApp
          </button>
          <button
            className={channelFilter === "webchat" ? "active" : ""}
            onClick={() => setChannelFilter("webchat")}
            title="Mostrar apenas Webchat"
          >
            Webchat
          </button>
        </div>

        <div className="chat-history-search">
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou última mensagem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="chat-history-list">
          {loadingConversations && (
            <div className="chat-history-empty">Carregando histórico...</div>
          )}

          {!loadingConversations && filteredConversations.length === 0 && (
            <div className="chat-history-empty">
              Nenhum atendimento humano encontrado com os filtros atuais.
            </div>
          )}

          {filteredConversations.map((conv) => {
            const unread = unreadCounts[String(conv.id)] || 0;
            const ch = normalizeChannel(conv);

            return (
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
                    {conv.contactName || conv.phone}
                  </span>

                  {/* ✅ badge do canal */}
                  <span
                    className="chat-history-status"
                    style={{
                      marginLeft: 10,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "rgba(255,255,255,.06)",
                      border: "1px solid rgba(255,255,255,.08)"
                    }}
                    title={`Canal: ${channelLabel(ch)}`}
                  >
                    {channelLabel(ch)}
                  </span>

                  <span className="chat-history-status" style={{ marginLeft: 10 }}>
                    {conv.status === "open" ? "Aberta" : "Encerrada"}
                  </span>

                  {unread > 0 && (
                    <span className="chat-history-unread-badge">{unread}</span>
                  )}
                </div>

                <div className="chat-history-phone">{conv.phone}</div>

                <div className="chat-history-last-message">
                  {conv.lastMessage ||
                    conv.lastMessagePreview ||
                    "Sem mensagens ainda"}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* COLUNA CENTRAL + DIREITA – CHAT + PAINEL CONTATO */}
      <section className="chat-history-main">
        {selectedConversation ? (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, minWidth: 0, height: "100%" }}>
              <ChatPanel
                conversation={selectedConversation}
                messages={messages}
                loadingMessages={loadingMessages}
                onSendText={handleSendText}
                onSendMedia={handleSendMedia}
                onChangeStatus={handleChangeStatus}
              />
            </div>

            <aside className="chat-contact-panel">
              <div className="chat-contact-section">
                <div className="chat-contact-label">Informações do contato</div>
                <div className="chat-contact-name">
                  {selectedConversation.contactName || "Sem nome"}
                </div>
                <div className="chat-contact-phone">
                  {selectedConversation.phone}
                </div>

                {/* ✅ canal no painel */}
                <div style={{ marginTop: 10 }}>
                  <div className="chat-contact-label">Canal</div>
                  <div className="chat-contact-value">
                    {channelLabel(normalizeChannel(selectedConversation))}
                  </div>
                </div>
              </div>

              <div className="chat-contact-section">
                <div className="chat-contact-label">Última atualização</div>
                <div className="chat-contact-value">
                  {selectedConversation.updatedAt
                    ? new Date(selectedConversation.updatedAt).toLocaleString()
                    : "—"}
                </div>
              </div>

              <div className="chat-contact-section">
                <div className="chat-contact-label">Tags / Observações</div>
                <div className="chat-contact-value">Nenhuma tag cadastrada.</div>
              </div>
            </aside>
          </div>
        ) : (
          <div className="chat-history-placeholder">
            <h2>Nenhum atendimento selecionado</h2>
            <p>
              Escolha um atendimento na coluna à esquerda para visualizar o
              histórico. Você pode aplicar filtros por status, canal e buscar
              por nome ou telefone.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
