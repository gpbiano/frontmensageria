// frontend/src/pages/ChatHumanPage.jsx
import "../../styles/chat-human.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConversations,
  fetchMessages,
  sendTextMessage,
  sendMediaMessage,
  updateConversationStatus
} from "../../api"; // ✅ IMPORTANTÍSSIMO: use o api.ts (sem .js)

import ChatPanel from "../../components/ChatPanel.jsx";

const NOTIF_KEY = "gpLabsNotificationSettings";
const QUIET_START_HOUR = 22; // 22h
const QUIET_END_HOUR = 7; // 07h

function labelChannel(source) {
  const s = String(source || "").toLowerCase();
  if (s === "whatsapp") return "WhatsApp";
  if (s === "webchat") return "WebChat";
  if (!s) return "—";
  return s;
}

// Tela de ATENDIMENTO AO VIVO (conversas abertas)
export default function ChatHumanPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null); // ✅ string | null
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  // sempre "open" aqui
  const statusFilter = "open";

  const [unreadCounts, setUnreadCounts] = useState({}); // ✅ Record<string, number>
  const prevOpenConversationsCount = useRef(0);
  const prevConversationsMapRef = useRef(new Map());

  const [botAlert, setBotAlert] = useState(false);
  const lastBotMessageIdRef = useRef(null);

  const [isTabActive, setIsTabActive] = useState(!document.hidden);
  const lastActivityRef = useRef(Date.now());

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  // ✅ UI local: tags + notas do agente (persistência no backend)
  const [tagInput, setTagInput] = useState("");
  const [localTags, setLocalTags] = useState([]);
  const [localNotes, setLocalNotes] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaSavedMsg, setMetaSavedMsg] = useState("");

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
      const payload = JSON.stringify({ notificationsEnabled, quietHoursEnabled });
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
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("mousemove", markActivity);
      window.removeEventListener("keydown", markActivity);
      window.removeEventListener("click", markActivity); // ✅ faltava
      window.removeEventListener("scroll", markActivity);
    };
  }, []);

  // ---------------------------------------------
  // LOAD CONVERSAS (apenas ABERTAS)
  // ---------------------------------------------
  const loadingConvsRef = useRef(false);

  const loadConversations = useCallback(
    async (options = { playSoundOnNew: false }) => {
      if (loadingConvsRef.current) return; // ✅ evita overlap
      loadingConvsRef.current = true;

      try {
        setLoadingConversations((prev) => prev && !options.playSoundOnNew);

        const data = await fetchConversations(statusFilter);
        const list = Array.isArray(data) ? data : [];

        // ✅ normaliza ids como string SEMPRE
        const normalizedList = list
          .filter((c) => c && c.id != null)
          .map((c) => ({
            ...c,
            id: String(c.id),
            source: c.source || c.channel
          }));

        const prevMap = prevConversationsMapRef.current;
        const newMap = new Map();

        let newChatDetected = false;
        let otherConversationUpdated = false;

        for (const conv of normalizedList) {
          const convId = String(conv.id);
          const prevUpdatedAt = prevMap.get(convId);
          const currentUpdatedAt = conv.updatedAt || null;

          if (prevUpdatedAt == null && prevMap.size > 0) {
            newChatDetected = true;
          } else if (
            prevUpdatedAt &&
            currentUpdatedAt &&
            new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
            convId !== String(selectedConversationId || "")
          ) {
            otherConversationUpdated = true;
          }

          newMap.set(convId, currentUpdatedAt);
        }

        prevConversationsMapRef.current = newMap;

        setUnreadCounts((prev) => {
          const next = { ...prev };
          const idsSet = new Set(normalizedList.map((c) => String(c.id)));

          // ✅ NÃO converte para Number (ids são string)
          Object.keys(next).forEach((id) => {
            if (!idsSet.has(id)) delete next[id];
          });

          for (const conv of normalizedList) {
            const convId = String(conv.id);
            const prevUpdatedAt = prevMap.get(convId);
            const currentUpdatedAt = conv.updatedAt || null;

            const isNewConv = prevUpdatedAt == null && prevMap.size > 0;
            const isUpdatedOtherConv =
              prevUpdatedAt &&
              currentUpdatedAt &&
              new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
              convId !== String(selectedConversationId || "");

            if (isNewConv || isUpdatedOtherConv) {
              next[convId] = (next[convId] || 0) + 1;
            }

            if (convId === String(selectedConversationId || "")) {
              next[convId] = 0;
            }
          }

          return next;
        });

        if (options.playSoundOnNew) {
          const openNow = normalizedList.length;
          const prevOpen = prevOpenConversationsCount.current;

          if (prevOpen && openNow > prevOpen) newChatDetected = true;
          prevOpenConversationsCount.current = openNow;
        } else {
          prevOpenConversationsCount.current = normalizedList.length;
        }

        if (newChatDetected) {
          const { isIdle } = getIdleInfo();
          const intensity = !isTabActive || isIdle ? "strong" : "soft";
          playNotification("new-chat", { intensity });
        }

        if (otherConversationUpdated) {
          const { isIdle } = getIdleInfo();
          const intensity = !isTabActive || isIdle ? "strong" : "soft";
          playNotification("received", { intensity });
        }

        setConversations(normalizedList);

        // ✅ se conversa sumiu da lista (foi fechada), limpa seleção
        if (normalizedList.length === 0) {
          setSelectedConversationId(null);
          setMessages([]);
        } else if (selectedConversationId) {
          const stillExists = normalizedList.some(
            (c) => String(c.id) === String(selectedConversationId)
          );
          if (!stillExists) {
            setSelectedConversationId(null);
            setMessages([]);
          }
        }
      } catch (err) {
        console.error("Erro ao carregar conversas:", err);
      } finally {
        setLoadingConversations(false);
        loadingConvsRef.current = false;
      }
    },
    [selectedConversationId, isTabActive, statusFilter]
  );

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

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
  const loadingMsgsRef = useRef(false);

  const loadMessages = useCallback(async () => {
    if (!selectedConversationId) return;
    if (loadingMsgsRef.current) return;
    loadingMsgsRef.current = true;

    try {
      setLoadingMessages(true);
      const data = await fetchMessages(String(selectedConversationId));
      setMessages(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
    } finally {
      setLoadingMessages(false);
      loadingMsgsRef.current = false;
    }
  }, [selectedConversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [selectedConversationId, loadMessages]);

  // ---------------------------------------------
  // ALERTA VISUAL BOT (banner no topo)
  // ---------------------------------------------
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const botMessages = messages.filter((m) => m.isBot || m.fromBot || m.from === "bot");
    if (botMessages.length === 0) return;

    const lastBotMsg = botMessages[botMessages.length - 1];
    const botId = String(lastBotMsg?.id || lastBotMsg?.waMessageId || "");

    if (!botId) return;
    if (lastBotMessageIdRef.current === botId) return;
    lastBotMessageIdRef.current = botId;

    setBotAlert(true);
    const timeout = setTimeout(() => setBotAlert(false), 4000);
    return () => clearTimeout(timeout);
  }, [messages]);

  // ---------------------------------------------
  // SOM – MENSAGEM INBOUND NA CONVERSA ATUAL
  // ---------------------------------------------
  useEffect(() => {
    if (!messages || messages.length === 0) return;

    const last = messages[messages.length - 1];
    if (!last) return;

    if (last.direction === "in" && !last.isBot && !last.fromBot && last.from !== "bot") {
      const { isIdle } = getIdleInfo();
      if (isTabActive && !isIdle) return;

      const intensity = !isTabActive && isIdle ? "strong" : "soft";
      playNotification("received", { intensity });
    }
  }, [messages, isTabActive]);

  // ---------------------------------------------
  // LISTAS DERIVADAS
  // ---------------------------------------------
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      const name = String(c.contactName || "").toLowerCase();
      const phone = String(c.phone || c.peerId || "").toLowerCase();
      const last = String(c.lastMessage || c.lastMessagePreview || "").toLowerCase();

      return !term || name.includes(term) || phone.includes(term) || last.includes(term);
    });
  }, [conversations, searchTerm]);

  const selectedConversation = useMemo(() => {
    if (!selectedConversationId) return null;
    return conversations.find((c) => String(c.id) === String(selectedConversationId)) || null;
  }, [conversations, selectedConversationId]);

  // ✅ Sempre que selecionar conversa, carregar tags/notas locais
  useEffect(() => {
    if (!selectedConversation) return;
    setLocalTags(Array.isArray(selectedConversation.tags) ? selectedConversation.tags : []);
    setLocalNotes(String(selectedConversation.notes || ""));
    setTagInput("");
    setMetaSavedMsg("");
  }, [selectedConversationId]); // intencional

  // ---------------------------------------------
  // AÇÕES
  // ---------------------------------------------
  const handleSelectConversation = (id) => {
    const convId = String(id);
    setSelectedConversationId(convId);
    setMessages([]);
    setUnreadCounts((prev) => ({ ...prev, [convId]: 0 }));
  };

  const handleSendText = async (text) => {
    if (!selectedConversationId || !text.trim()) return;

    try {
      const created = await sendTextMessage(String(selectedConversationId), text.trim(), "Atendente");
      if (created) setMessages((prev) => [...prev, created]);
      // ✅ puxa de novo pra garantir sincronismo com backend
      loadMessages();

      try {
        const audio = new Audio("/send.mp3");
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}
    } catch (e) {
      console.error("Erro ao enviar mensagem:", e);
    }
  };

  const handleSendMedia = async ({ type, mediaUrl, caption }) => {
    if (!selectedConversationId || !mediaUrl) return;

    try {
      const created = await sendMediaMessage(String(selectedConversationId), {
        type,
        mediaUrl,
        caption
      });
      if (created) setMessages((prev) => [...prev, created]);
      loadMessages();

      try {
        const audio = new Audio("/send.mp3");
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}
    } catch (e) {
      console.error("Erro ao enviar mídia:", e);
    }
  };

  // ✅ Regra: conversa não pode ser reaberta (histórico é outra tela)
  const handleChangeStatus = async (conversationId, newStatus) => {
    const convId = String(conversationId);
    if (newStatus === "open") return;

    try {
      await updateConversationStatus(convId, newStatus);

      if (newStatus === "closed") {
        // ✅ remove da lista local imediatamente e mantém fora
        setConversations((prev) => prev.filter((c) => String(c.id) !== convId));

        if (String(selectedConversationId || "") === convId) {
          setSelectedConversationId(null);
          setMessages([]);
        }

        // ✅ também zera contadores
        setUnreadCounts((prev) => {
          const next = { ...prev };
          delete next[convId];
          return next;
        });
      }
    } catch (err) {
      console.error("Erro ao alterar status:", err);
    }
  };

  // ---------------------------------------------
  // TAGS UI
  // ---------------------------------------------
  function addTagFromInput() {
    const v = tagInput.trim();
    if (!v) return;

    const exists = localTags.some((t) => String(t).toLowerCase() === v.toLowerCase());
    if (exists) {
      setTagInput("");
      return;
    }

    setLocalTags((prev) => [...prev, v]);
    setTagInput("");
  }

  function removeTag(tag) {
    setLocalTags((prev) => prev.filter((t) => t !== tag));
  }

  // ---------------------------------------------
  // SALVAR META (tags + notes) -> usa sua API helpers
  // ---------------------------------------------
  const handleSaveMeta = async () => {
    if (!selectedConversation) return;

    try {
      setSavingMeta(true);
      setMetaSavedMsg("");

      // ✅ usa os endpoints já padronizados no api.ts
      await updateConversationStatus(String(selectedConversation.id), "open", { tags: localTags });
      await updateConversationNotes(String(selectedConversation.id), localNotes);

      setConversations((prev) =>
        prev.map((c) =>
          String(c.id) === String(selectedConversation.id)
            ? { ...c, tags: localTags, notes: localNotes, updatedAt: new Date().toISOString() }
            : c
        )
      );

      setMetaSavedMsg("Salvo ✅");
      setTimeout(() => setMetaSavedMsg(""), 2500);
    } catch (e) {
      console.error("Erro ao salvar tags/observações:", e);
      setMetaSavedMsg("Falha ao salvar ❌");
      setTimeout(() => setMetaSavedMsg(""), 3000);
    } finally {
      setSavingMeta(false);
    }
  };

  // ---------------------------------------------
  // RENDER
  // ---------------------------------------------
  return (
    <div className={"chat-history-layout" + (botAlert ? " bot-alert" : "")}>
      {/* COLUNA ESQUERDA – CONVERSAS ABERTAS */}
      <aside className="chat-history-sidebar">
        <div className="chat-history-header">
          <div>
            <h1>Conversas</h1>
            <p>Fila de atendimento (tempo real)</p>
          </div>

          <div className="chat-history-notification-controls">
            <label className="notif-toggle">
              <input
                type="checkbox"
                checked={notificationsEnabled}
                onChange={(e) => setNotificationsEnabled(e.target.checked)}
              />
              <span>🔊 Som</span>
            </label>
            <label className="notif-toggle">
              <input
                type="checkbox"
                checked={quietHoursEnabled}
                onChange={(e) => setQuietHoursEnabled(e.target.checked)}
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

        <div className="chat-history-list">
          {loadingConversations && (
            <div className="chat-history-empty">Carregando conversas...</div>
          )}

          {!loadingConversations && filteredConversations.length === 0 && (
            <div className="chat-history-empty">
              Nenhuma conversa aguardando atendimento no momento.
            </div>
          )}

          {filteredConversations.map((conv) => {
            const convId = String(conv.id);
            const unread = unreadCounts[convId] || 0;
            const source = conv.source || conv.channel;

            return (
              <button
                key={convId}
                className={
                  "chat-history-item" +
                  (convId === String(selectedConversationId || "") ? " selected" : "")
                }
                onClick={() => handleSelectConversation(convId)}
              >
                <div className="chat-history-item-main">
                  <span className="chat-history-contact-name">
                    {conv.contactName || conv.phone || conv.peerId}
                  </span>

                  <span className={"chat-channel-badge " + String(source || "").toLowerCase()}>
                    {labelChannel(source)}
                  </span>

                  {unread > 0 && (
                    <span className="chat-history-unread-badge">{unread}</span>
                  )}
                </div>

                <div className="chat-history-phone">
                  {conv.phone || (conv.peerId?.startsWith("wa:") ? conv.peerId.slice(3) : conv.peerId)}
                </div>

                <div className="chat-history-last-message">
                  {conv.lastMessage || conv.lastMessagePreview || "Sem mensagens ainda"}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* COLUNA CENTRAL + DIREITA */}
      <section className="chat-history-main">
        {!selectedConversation ? (
          <div className="chat-waiting-state">
            <div className="chat-waiting-box">
              <div className="chat-waiting-emoji">💬</div>
              <h2>Aguardando novas conversas</h2>
              <p>
                Quando um cliente iniciar contato (WhatsApp, WebChat ou outro canal),
                o atendimento aparecerá na coluna à esquerda.
              </p>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
            {/* CENTRO */}
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

            {/* DIREITA */}
            <aside className="chat-contact-panel">
              <div className="chat-contact-section">
                <div className="chat-contact-label">Informações do contato</div>
                <div className="chat-contact-name">
                  {selectedConversation.contactName || "Sem nome"}
                </div>
                <div className="chat-contact-phone">
                  {selectedConversation.phone ||
                    (selectedConversation.peerId?.startsWith("wa:")
                      ? selectedConversation.peerId.slice(3)
                      : selectedConversation.peerId) ||
                    "—"}
                </div>

                <div className="chat-contact-minirow">
                  <span className="chat-contact-mini-label">Canal</span>
                  <span
                    className={
                      "chat-channel-badge " +
                      String(selectedConversation.source || selectedConversation.channel || "").toLowerCase()
                    }
                  >
                    {labelChannel(selectedConversation.source || selectedConversation.channel)}
                  </span>
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
                <div className="chat-contact-label">Tags</div>

                <div className="chat-tags-wrap">
                  {localTags.length === 0 ? (
                    <div className="chat-contact-value muted">Nenhuma tag cadastrada.</div>
                  ) : (
                    <div className="chat-tags">
                      {localTags.map((t) => (
                        <span key={t} className="chat-tag">
                          {t}
                          <button
                            type="button"
                            className="chat-tag-remove"
                            onClick={() => removeTag(t)}
                            title="Remover"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="chat-tag-inputrow">
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTagFromInput();
                      }
                    }}
                    placeholder="Adicionar tag e Enter…"
                  />
                  <button type="button" onClick={addTagFromInput}>
                    Add
                  </button>
                </div>
              </div>

              <div className="chat-contact-section">
                <div className="chat-contact-label">Observações internas</div>
                <textarea
                  className="chat-notes"
                  placeholder="Anotações visíveis apenas para o time…"
                  value={localNotes}
                  onChange={(e) => setLocalNotes(e.target.value)}
                  rows={6}
                />
              </div>

              <div className="chat-contact-section">
                <button
                  type="button"
                  className="chat-meta-save"
                  onClick={handleSaveMeta}
                  disabled={savingMeta}
                >
                  {savingMeta ? "Salvando..." : "Salvar tags e observações"}
                </button>

                {metaSavedMsg ? <div className="chat-meta-saved">{metaSavedMsg}</div> : null}
              </div>
            </aside>
          </div>
        )}
      </section>
    </div>
  );
}
