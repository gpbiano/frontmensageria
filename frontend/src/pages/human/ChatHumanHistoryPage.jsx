// frontend/src/pages/ChatHumanHistoryPage.jsx
import "../../styles/chat-history.css";
import "../../styles/chat-panel.css";


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchConversations,
  fetchMessages,
  sendTextMessage,
  sendMediaMessage,
  updateConversationStatus,
  downloadConversationHistoryCSV
} from "../../api.js";
import ChatPanel from "../../components/ChatPanel.jsx";

const NOTIF_KEY = "gpLabsNotificationSettings";
const QUIET_START_HOUR = 22;
const QUIET_END_HOUR = 7;

// --------------------------------------------------
// HELPERS
// --------------------------------------------------
function normalizeChannel(conv) {
  const raw = String(conv?.source || conv?.channel || "").toLowerCase();
  if (raw.includes("webchat")) return "webchat";
  if (raw.includes("whatsapp") || raw.includes("wa")) return "whatsapp";
  return raw || "whatsapp";
}
function channelLabel(ch) {
  if (ch === "webchat") return "Webchat";
  if (ch === "whatsapp") return "WhatsApp";
  return ch || "Canal";
}
function formatDateShort(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}
function safeStr(v) {
  return String(v ?? "").trim();
}

/**
 * ✅ REGRA OFICIAL DE AUDITORIA HUMANA:
 * entra no Histórico Humano se houve humano em algum momento
 * - passou para humano
 * - OU foi atribuída a usuário/grupo
 * - OU foi encerrada manualmente por agente
 */
function isHumanAuditableConversation(c) {
  const mode = String(c?.currentMode || "").toLowerCase();
  const status = String(c?.status || "").toLowerCase();

  const assigned = Boolean(c?.assignedUserId || c?.assignedGroupId);
  const closedByAgent = String(c?.closedBy || "").toLowerCase() === "agent";
  const closedManual =
    String(c?.closedReason || "").toLowerCase() === "manual_by_agent";

  if (mode === "human") return true;
  if (assigned) return true;
  if (status === "closed" && (closedByAgent || closedManual)) return true;

  return false;
}

export default function ChatHumanHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [messages, setMessages] = useState([]);

  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | closed
  const [channelFilter, setChannelFilter] = useState("all"); // all | whatsapp | webchat

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);

  const prevMapRef = useRef(new Map());
  const lastActivityRef = useRef(Date.now());
  const [isTabActive, setIsTabActive] = useState(!document.hidden);

  const [exporting, setExporting] = useState(false);

  // --------------------------------------------------
  // NOTIFICAÇÕES
  // --------------------------------------------------
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
    if (type !== "received") return;

    try {
      const audio = new Audio("/received.mp3");
      audio.volume = intensity === "strong" ? 1 : 0.45;
      audio.play().catch(() => {});
    } catch {}
  }

  function getIdleInfo() {
    const idleMs = Date.now() - lastActivityRef.current;
    return { idleMs, isIdle: idleMs > 60_000 };
  }

  // --------------------------------------------------
  // BOOT CONFIG
  // --------------------------------------------------
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
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(
        NOTIF_KEY,
        JSON.stringify({ notificationsEnabled, quietHoursEnabled })
      );
    } catch {}
  }, [notificationsEnabled, quietHoursEnabled]);

  // --------------------------------------------------
  // VISIBILIDADE + ATIVIDADE
  // --------------------------------------------------
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
      window.removeEventListener("click", markActivity);
      window.removeEventListener("scroll", markActivity);
    };
  }, []);

  // --------------------------------------------------
  // LOAD CONVERSAS (AUDITORIA HUMANA)
  // --------------------------------------------------
  const loadConversations = useCallback(async () => {
    try {
      setLoadingConversations(true);

      const data = await fetchConversations("all");
      const list = Array.isArray(data) ? data : [];

      const humanList = list.filter(isHumanAuditableConversation);

      // notifica se atualizou em outra conversa
      const prevMap = prevMapRef.current;
      const newMap = new Map();
      let otherUpdated = false;

      for (const c of humanList) {
        const id = String(c.id);
        const prevUpdatedAt = prevMap.get(id);
        const currentUpdatedAt = c.updatedAt || null;

        if (
          prevUpdatedAt &&
          currentUpdatedAt &&
          new Date(currentUpdatedAt) > new Date(prevUpdatedAt) &&
          String(id) !== String(selectedConversationId)
        ) {
          otherUpdated = true;
        }
        newMap.set(id, currentUpdatedAt);
      }

      prevMapRef.current = newMap;

      if (otherUpdated) {
        const { isIdle } = getIdleInfo();
        playNotification("received", {
          intensity: !isTabActive || isIdle ? "strong" : "soft"
        });
      }

      humanList.sort((a, b) => {
        const da = Date.parse(a?.updatedAt || a?.createdAt || "") || 0;
        const db = Date.parse(b?.updatedAt || b?.createdAt || "") || 0;
        return db - da;
      });

      setConversations(humanList);

      if (!selectedConversationId && humanList.length > 0) {
        setSelectedConversationId(humanList[0].id);
      }

      if (
        selectedConversationId &&
        !humanList.some((c) => String(c.id) === String(selectedConversationId))
      ) {
        setSelectedConversationId(humanList[0]?.id || null);
        setMessages([]);
      }
    } catch (err) {
      console.error("Erro ao carregar histórico humano:", err);
    } finally {
      setLoadingConversations(false);
    }
  }, [selectedConversationId, isTabActive]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const i = setInterval(loadConversations, 8000);
    return () => clearInterval(i);
  }, [loadConversations]);

  // --------------------------------------------------
  // LOAD MENSAGENS (BOT + HUMANO + SISTEMA)
  // --------------------------------------------------
  const loadMessages = useCallback(async () => {
    if (!selectedConversationId) return;
    try {
      setLoadingMessages(true);
      const res = await fetchMessages(selectedConversationId);

      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
        ? res
        : [];

      setMessages(list);
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
      setMessages([]);
    } finally {
      setLoadingMessages(false);
    }
  }, [selectedConversationId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!selectedConversationId) return;
    const i = setInterval(loadMessages, 4000);
    return () => clearInterval(i);
  }, [selectedConversationId, loadMessages]);

  // --------------------------------------------------
  // FILTROS
  // --------------------------------------------------
  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      const status = String(c?.status || "").toLowerCase();
      if (statusFilter !== "all" && status !== statusFilter) return false;

      const ch = normalizeChannel(c);
      if (channelFilter !== "all" && ch !== channelFilter) return false;

      if (!term) return true;

      const name = String(c?.contactName || c?.title || "").toLowerCase();
      const phone = String(c?.phone || "").toLowerCase();
      const last = String(c?.lastMessagePreview || c?.lastMessage || "").toLowerCase();

      return name.includes(term) || phone.includes(term) || last.includes(term);
    });
  }, [conversations, searchTerm, statusFilter, channelFilter]);

  const selectedConversation = useMemo(
    () =>
      conversations.find((c) => String(c.id) === String(selectedConversationId)) ||
      null,
    [conversations, selectedConversationId]
  );

  const counters = useMemo(() => {
    const total = conversations.length;
    const open = conversations.filter((c) => String(c.status) === "open").length;
    const closed = conversations.filter((c) => String(c.status) === "closed").length;
    return { total, open, closed };
  }, [conversations]);

  // --------------------------------------------------
  // AÇÕES
  // --------------------------------------------------
  const handleSendText = async (text) => {
    if (!selectedConversationId || !String(text || "").trim()) return;
    const created = await sendTextMessage(selectedConversationId, String(text).trim());
    if (created) setMessages((prev) => [...prev, created]);
  };

  const handleSendMedia = async (payload) => {
    if (!selectedConversationId) return;
    const created = await sendMediaMessage(selectedConversationId, payload);
    if (created) setMessages((prev) => [...prev, created]);
  };

  const handleChangeStatus = async (conversationId, newStatus) => {
    const updated = await updateConversationStatus(conversationId, newStatus);

    setConversations((prev) =>
      prev.map((c) => (String(c.id) === String(updated.id) ? updated : c))
    );

    if (statusFilter === "open" && newStatus === "closed") {
      setConversations((prev) =>
        prev.filter((c) => String(c.id) !== String(conversationId))
      );
      if (String(selectedConversationId) === String(conversationId)) {
        setSelectedConversationId(null);
        setMessages([]);
      }
    }
  };

  async function handleExportCSV() {
    if (!selectedConversation) return;
    try {
      setExporting(true);
      const name =
        safeStr(selectedConversation.contactName) ||
        safeStr(selectedConversation.title) ||
        safeStr(selectedConversation.phone) ||
        "conversa";
      await downloadConversationHistoryCSV(String(selectedConversation.id), name);
    } catch (e) {
      console.error("Erro exportando CSV:", e);
      alert("Não foi possível exportar o histórico agora.");
    } finally {
      setExporting(false);
    }
  }

  // --------------------------------------------------
  // RENDER
  // --------------------------------------------------
  return (
    <div className="chat-history-layout">
      <aside className="chat-history-sidebar">
        <div className="chat-history-header" style={{ gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 12,
                background: "rgba(34,197,94,0.16)",
                border: "1px solid rgba(34,197,94,0.25)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16
              }}
              title="Histórico Humano"
            >
              🗂️
            </div>
            <div>
              <h1 style={{ marginBottom: 4 }}>Histórico Humano</h1>
              <p style={{ margin: 0, opacity: 0.8, fontSize: 12 }}>
                Auditoria completa (bot + humano + sistema)
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <span className="chat-history-status" title="Total">
              Total: {counters.total}
            </span>
            <span className="chat-history-status" title="Abertas">
              Abertas: {counters.open}
            </span>
            <span className="chat-history-status" title="Encerradas">
              Encerradas: {counters.closed}
            </span>
          </div>
        </div>

        {/* filtros */}
        <div className="chat-history-filters" style={{ marginTop: 10 }}>
          <button className={statusFilter === "all" ? "active" : ""} onClick={() => setStatusFilter("all")}>
            Todas
          </button>
          <button className={statusFilter === "open" ? "active" : ""} onClick={() => setStatusFilter("open")}>
            Abertas
          </button>
          <button className={statusFilter === "closed" ? "active" : ""} onClick={() => setStatusFilter("closed")}>
            Encerradas
          </button>
        </div>

        <div className="chat-history-filters" style={{ marginTop: 10 }}>
          <button className={channelFilter === "all" ? "active" : ""} onClick={() => setChannelFilter("all")}>
            Todos
          </button>
          <button className={channelFilter === "whatsapp" ? "active" : ""} onClick={() => setChannelFilter("whatsapp")}>
            WhatsApp
          </button>
          <button className={channelFilter === "webchat" ? "active" : ""} onClick={() => setChannelFilter("webchat")}>
            Webchat
          </button>
        </div>

        <div className="chat-history-search" style={{ marginTop: 10 }}>
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou última mensagem..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="chat-history-list" style={{ marginTop: 10 }}>
          {loadingConversations && (
            <div className="chat-history-empty">Carregando histórico…</div>
          )}

          {!loadingConversations && filteredConversations.length === 0 && (
            <div className="chat-history-empty">
              Nenhum atendimento humano encontrado com os filtros atuais.
            </div>
          )}

          {!loadingConversations &&
            filteredConversations.map((c) => {
              const ch = normalizeChannel(c);
              const name = c?.contactName || c?.title || c?.phone || "Contato";
              const status = String(c?.status || "open").toLowerCase();

              const when = c?.lastMessageAt || c?.updatedAt || c?.createdAt;

              return (
                <button
                  key={String(c.id)}
                  className={
                    "chat-history-item" +
                    (String(c.id) === String(selectedConversationId) ? " selected" : "")
                  }
                  onClick={() => setSelectedConversationId(c.id)}
                  style={{
                    textAlign: "left",
                    padding: 12,
                    borderRadius: 14
                  }}
                >
                  <div className="chat-history-item-main" style={{ alignItems: "center" }}>
                    <span className="chat-history-contact-name">{name}</span>

                    <span
                      className="chat-history-status"
                      style={{
                        marginLeft: "auto",
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,.06)",
                        border: "1px solid rgba(255,255,255,.08)"
                      }}
                      title={`Canal: ${channelLabel(ch)}`}
                    >
                      {channelLabel(ch)}
                    </span>

                    <span className="chat-history-status" style={{ marginLeft: 8 }}>
                      {status === "open" ? "Aberta" : "Encerrada"}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginTop: 6, opacity: 0.85, fontSize: 12 }}>
                    <span>{c?.phone || "—"}</span>
                    <span>•</span>
                    <span>{when ? formatDateShort(when) : "—"}</span>
                  </div>

                  <div className="chat-history-last-message" style={{ marginTop: 8 }}>
                    {c?.lastMessagePreview || c?.lastMessage || "Sem mensagens ainda"}
                  </div>
                </button>
              );
            })}
        </div>
      </aside>

      <section className="chat-history-main">
        {selectedConversation ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {/* barra superior do conteúdo */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(148,163,184,0.16)",
                background: "rgba(2,6,23,0.35)",
                marginBottom: 10
              }}
            >
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 13, opacity: 0.85 }}>
                  Conversa selecionada
                </div>
                <div style={{ fontSize: 12, opacity: 0.7 }}>
                  {channelLabel(normalizeChannel(selectedConversation))} •{" "}
                  {selectedConversation.status === "open" ? "Aberta" : "Encerrada"} •{" "}
                  {selectedConversation.updatedAt ? formatDateShort(selectedConversation.updatedAt) : "—"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={!selectedConversationId || exporting}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 12,
                    border: "1px solid rgba(34,197,94,0.25)",
                    background: exporting ? "rgba(34,197,94,0.10)" : "rgba(34,197,94,0.14)",
                    color: "#e5e7eb",
                    cursor: exporting ? "not-allowed" : "pointer",
                    fontSize: 12
                  }}
                  title="Exportar histórico (CSV/Excel)"
                >
                  {exporting ? "Exportando..." : "⬇️ Exportar Excel (CSV)"}
                </button>
              </div>
            </div>

            {/* chat */}
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel
                conversation={selectedConversation}
                messages={messages}
                loadingMessages={loadingMessages}
                onSendText={handleSendText}
                onSendMedia={handleSendMedia}
                onChangeStatus={handleChangeStatus}
              />
            </div>
          </div>
        ) : (
          <div className="chat-history-placeholder">
            <h2>Nenhum atendimento selecionado</h2>
            <p>Selecione um item na lista para visualizar o histórico.</p>
          </div>
        )}
      </section>
    </div>
  );
}
