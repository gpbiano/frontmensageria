// frontend/src/pages/ChatbotHistoryPage.jsx
import "../../styles/chatbot-history.css";

import { useEffect, useMemo, useState } from "react";
import { fetchConversations, fetchMessages } from "../../api.js";

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

function safeLocale(dt) {
  try {
    return dt ? new Date(dt).toLocaleString() : "—";
  } catch {
    return "—";
  }
}

function msgText(m) {
  return (
    m?.text ||
    m?.body ||
    m?.caption ||
    (m?.type ? `[${m.type}]` : "[mensagem]")
  );
}

export default function ChatbotHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // drawer
  const [openId, setOpenId] = useState(null);
  const [openConv, setOpenConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState("");

  async function load() {
    try {
      setLoading(true);
      setError("");

      const data = await fetchConversations({
        status: "all",
        kind: "bot"
      });

      setConversations(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
      setError("Erro ao carregar histórico do bot.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = searchTerm.toLowerCase();

    return conversations.filter((c) => {
      const status = String(c.status || "").toLowerCase();
      const ch = normalizeChannel(c);

      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (channelFilter !== "all" && ch !== channelFilter) return false;

      const name = String(c.contactName || "").toLowerCase();
      const phone = String(c.phone || "").toLowerCase();
      const last = String(c.lastMessagePreview || "").toLowerCase();

      if (!term) return true;
      return name.includes(term) || phone.includes(term) || last.includes(term);
    });
  }, [conversations, statusFilter, channelFilter, searchTerm]);

  async function openConversation(c) {
    setOpenId(c.id);
    setOpenConv(c);
    setMessages([]);
    setMsgError("");

    try {
      setMsgLoading(true);
      const res = await fetchMessages(c.id);
      setMessages(Array.isArray(res) ? res : []);
    } catch (err) {
      setMsgError("Erro ao carregar mensagens.");
    } finally {
      setMsgLoading(false);
    }
  }

  function closeDrawer() {
    setOpenId(null);
    setOpenConv(null);
    setMessages([]);
  }

  return (
    <div className="cbh-page">
      <div className="cbh-card">
        <h1 className="cbh-title">Histórico do Chatbot</h1>

        {loading && <div className="cbh-loading">Carregando…</div>}
        {error && <div className="cbh-alert">{error}</div>}

        {!loading && filtered.length === 0 && (
          <div className="cbh-empty">Nenhuma conversa encontrada.</div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="cbh-list">
            {filtered.map((c) => (
              <button
                key={c.id}
                className="cbh-item cbh-clickable"
                onClick={() => openConversation(c)}
              >
                <div style={{ flex: 1 }}>
                  <div className="cbh-item-title">
                    <span className="cbh-name">
                      {c.contactName || c.phone || "Contato"}
                    </span>
                  </div>

                  <div className="cbh-last">
                    {c.lastMessagePreview || "Sem mensagem"}
                  </div>

                  <div className="cbh-meta">
                    <span className={`cbh-badge ${c.status}`}>
                      {c.status === "open" ? "Aberta" : "Encerrada"}
                    </span>

                    <span className="cbh-badge">
                      {channelLabel(normalizeChannel(c))}
                    </span>

                    <span className="cbh-time">
                      {safeLocale(c.updatedAt)}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {openId && (
        <div className="cbh-drawer-overlay" onClick={closeDrawer}>
          <aside className="cbh-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="cbh-drawer-header">
              <strong>
                {openConv?.contactName || openConv?.phone || "Conversa"}
              </strong>
              <button onClick={closeDrawer}>Fechar</button>
            </div>

            <div className="cbh-drawer-body">
              {msgLoading && <div>Carregando mensagens…</div>}
              {msgError && <div>{msgError}</div>}

              {!msgLoading &&
                messages.map((m, i) => (
                  <div key={m.id || i} className="cbh-msg">
                    <div className="cbh-msg-bubble">
                      {msgText(m)}
                      <div className="cbh-msg-time">
                        {safeLocale(m.createdAt)}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
