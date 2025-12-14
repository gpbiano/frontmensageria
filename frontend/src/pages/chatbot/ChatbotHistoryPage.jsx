// frontend/src/pages/ChatbotHistoryPage.jsx
import "../../styles/chatbot.css";

import { useEffect, useMemo, useState } from "react";
import { fetchConversations, fetchMessages } from "../../api.js";

/**
 * Regras:
 * - Só entram conversas com botAttempts > 0 (bot atuou em algum momento)
 * - Classificação:
 *    - "bot_resolved": status "closed" e currentMode === "bot"
 *    - "transferred": currentMode === "human"
 *    - "in_bot": status "open" e currentMode === "bot"
 *    - "mixed": demais casos
 */

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

function classifyOutcome(conv) {
  const botAttempts = Number(conv?.botAttempts || 0);
  if (botAttempts <= 0) return null;

  const status = String(conv?.status || "").toLowerCase();
  const mode = String(conv?.currentMode || "").toLowerCase();

  if (mode === "human") return "transferred";
  if (status === "closed" && mode === "bot") return "bot_resolved";
  if (status === "open" && mode === "bot") return "in_bot";
  return "mixed";
}

function outcomeLabel(outcome) {
  if (outcome === "bot_resolved") return "Resolvido pelo bot";
  if (outcome === "transferred") return "Transferido para humano";
  if (outcome === "in_bot") return "Em andamento com o bot";
  return "Misto";
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
    (m?.type === "image" ? "[imagem]" : "") ||
    (m?.type === "audio" ? "[áudio]" : "") ||
    (m?.type === "video" ? "[vídeo]" : "") ||
    (m?.type ? `[${m.type}]` : "[mensagem]")
  );
}

export default function ChatbotHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | closed
  const [outcomeFilter, setOutcomeFilter] = useState("all"); // all | bot_resolved | transferred | in_bot | mixed
  const [channelFilter, setChannelFilter] = useState("all"); // ✅ all | whatsapp | webchat
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // drawer (detalhe)
  const [openId, setOpenId] = useState(null);
  const [openConv, setOpenConv] = useState(null);
  const [msgLoading, setMsgLoading] = useState(false);
  const [msgError, setMsgError] = useState("");
  const [messages, setMessages] = useState([]);

  async function load() {
    try {
      setLoading(true);
      setError("");

      const data = await fetchConversations("all");
      const list = Array.isArray(data) ? data : [];

      const withBot = list.filter((c) => Number(c?.botAttempts || 0) > 0);

      withBot.sort((a, b) => {
        const da = Date.parse(a?.updatedAt || "") || 0;
        const db = Date.parse(b?.updatedAt || "") || 0;
        return db - da;
      });

      setConversations(withBot);
    } catch (err) {
      console.error("Erro ao carregar histórico do bot:", err);
      setError(err?.message || "Erro ao carregar histórico do bot.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredConversations = useMemo(() => {
    const term = String(searchTerm || "").trim().toLowerCase();

    return conversations.filter((c) => {
      const outcome = classifyOutcome(c);
      if (!outcome) return false;

      const status = String(c?.status || "").toLowerCase();
      const ch = normalizeChannel(c);

      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (outcomeFilter !== "all" && outcome !== outcomeFilter) return false;

      // ✅ filtro por canal
      if (channelFilter !== "all" && ch !== channelFilter) return false;

      const name = String(c?.contactName || "").toLowerCase();
      const phone = String(c?.phone || "").toLowerCase();
      const last =
        String(c?.lastMessage || c?.lastMessagePreview || "").toLowerCase();

      if (!term) return true;
      return name.includes(term) || phone.includes(term) || last.includes(term);
    });
  }, [conversations, statusFilter, outcomeFilter, channelFilter, searchTerm]);

  const stats = useMemo(() => {
    let total = conversations.length;
    let botResolved = 0;
    let transferred = 0;
    let inBot = 0;

    conversations.forEach((c) => {
      const o = classifyOutcome(c);
      if (o === "bot_resolved") botResolved++;
      else if (o === "transferred") transferred++;
      else if (o === "in_bot") inBot++;
    });

    return { total, botResolved, transferred, inBot };
  }, [conversations]);

  async function openConversation(c) {
    const id = c?.id;
    if (!id) return;

    setOpenId(id);
    setOpenConv(c);
    setMessages([]);
    setMsgError("");

    try {
      setMsgLoading(true);
      const res = await fetchMessages(id);
      const list = Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
        ? res
        : [];
      setMessages(list);
    } catch (err) {
      console.error("Erro ao carregar mensagens:", err);
      setMsgError(err?.message || "Erro ao carregar mensagens da conversa.");
    } finally {
      setMsgLoading(false);
    }
  }

  function closeDrawer() {
    setOpenId(null);
    setOpenConv(null);
    setMessages([]);
    setMsgError("");
    setMsgLoading(false);
  }

  function onKeyDown(e) {
    if (e.key === "Escape" && openId) closeDrawer();
  }

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId]);

  return (
    <div className="cbh-page">
      <div className="cbh-card">
        <div className="cbh-top">
          <div>
            <h1 className="cbh-title">Histórico do Chatbot</h1>
            <p className="cbh-subtitle">
              Visão das conversas em que o bot atuou, com separação entre
              resolvidas pelo bot e transferidas para humanos.
            </p>

            <div style={{ marginTop: 10 }}>
              <button
                type="button"
                className="cbh-btn cbh-btn-ghost"
                onClick={load}
                disabled={loading}
                title="Recarregar"
              >
                {loading ? "Atualizando..." : "Atualizar"}
              </button>
            </div>
          </div>

          <div className="cbh-stats">
            <div className="cbh-stat">
              <div className="cbh-stat-label">Total com bot</div>
              <div className="cbh-stat-value">{stats.total}</div>
            </div>
            <div className="cbh-stat">
              <div className="cbh-stat-label">Resolvido pelo bot</div>
              <div className="cbh-stat-value">{stats.botResolved}</div>
            </div>
            <div className="cbh-stat">
              <div className="cbh-stat-label">Transferido para humano</div>
              <div className="cbh-stat-value">{stats.transferred}</div>
            </div>
            <div className="cbh-stat">
              <div className="cbh-stat-label">Em andamento com o bot</div>
              <div className="cbh-stat-value">{stats.inBot}</div>
            </div>
          </div>
        </div>

        <div className="cbh-filters">
          <div className="cbh-search">
            <input
              className="cbh-input"
              type="text"
              placeholder="Buscar por nome, telefone ou última mensagem..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="cbh-filter-block">
            <div className="cbh-filter-label">Status</div>
            <div className="cbh-pills">
              <button
                type="button"
                className={`cbh-pill ${statusFilter === "all" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("all")}
              >
                Todos
              </button>
              <button
                type="button"
                className={`cbh-pill ${statusFilter === "open" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("open")}
              >
                Abertas
              </button>
              <button
                type="button"
                className={`cbh-pill ${statusFilter === "closed" ? "is-active" : ""}`}
                onClick={() => setStatusFilter("closed")}
              >
                Encerradas
              </button>
            </div>
          </div>

          {/* ✅ CANAL */}
          <div className="cbh-filter-block">
            <div className="cbh-filter-label">Canal</div>
            <div className="cbh-pills">
              <button
                type="button"
                className={`cbh-pill ${channelFilter === "all" ? "is-active" : ""}`}
                onClick={() => setChannelFilter("all")}
              >
                Todos
              </button>
              <button
                type="button"
                className={`cbh-pill ${channelFilter === "whatsapp" ? "is-active" : ""}`}
                onClick={() => setChannelFilter("whatsapp")}
              >
                WhatsApp
              </button>
              <button
                type="button"
                className={`cbh-pill ${channelFilter === "webchat" ? "is-active" : ""}`}
                onClick={() => setChannelFilter("webchat")}
              >
                Webchat
              </button>
            </div>
          </div>

          <div className="cbh-filter-block">
            <div className="cbh-filter-label">Resultado</div>
            <div className="cbh-pills">
              <button
                type="button"
                className={`cbh-pill ${outcomeFilter === "all" ? "is-active" : ""}`}
                onClick={() => setOutcomeFilter("all")}
              >
                Todos
              </button>
              <button
                type="button"
                className={`cbh-pill ${outcomeFilter === "bot_resolved" ? "is-active" : ""}`}
                onClick={() => setOutcomeFilter("bot_resolved")}
              >
                Resolvido pelo bot
              </button>
              <button
                type="button"
                className={`cbh-pill ${outcomeFilter === "transferred" ? "is-active" : ""}`}
                onClick={() => setOutcomeFilter("transferred")}
              >
                Transferido para humano
              </button>
              <button
                type="button"
                className={`cbh-pill ${outcomeFilter === "in_bot" ? "is-active" : ""}`}
                onClick={() => setOutcomeFilter("in_bot")}
              >
                Em andamento com o bot
              </button>
            </div>
          </div>
        </div>

        {error && <div className="cbh-alert">{error}</div>}

        {loading && (
          <div className="cbh-loading">Carregando histórico do bot...</div>
        )}

        {!loading && !error && filteredConversations.length === 0 && (
          <div className="cbh-empty">
            Nenhuma conversa encontrada com os filtros atuais.
          </div>
        )}

        {!loading && !error && filteredConversations.length > 0 && (
          <div className="cbh-list">
            {filteredConversations.map((c) => {
              const outcome = classifyOutcome(c);
              const status = String(c?.status || "").toLowerCase();
              const phone = c?.phone || "—";
              const displayName = c?.contactName || phone;
              const ch = normalizeChannel(c);

              let outcomeClass = "res-running";
              if (outcome === "bot_resolved") outcomeClass = "res-bot";
              else if (outcome === "transferred") outcomeClass = "res-human";
              else if (outcome === "in_bot") outcomeClass = "res-running";

              return (
                <button
                  key={c.id || `${phone}-${c.updatedAt}`}
                  type="button"
                  className="cbh-item cbh-clickable"
                  onClick={() => openConversation(c)}
                  style={{ textAlign: "left" }}
                  aria-label={`Abrir conversa ${displayName}`}
                >
                  <div style={{ flex: 1 }}>
                    <div className="cbh-item-title">
                      <span className="cbh-name">{displayName}</span>
                      <span className="cbh-dot" />
                      <span className="cbh-phone">{phone}</span>
                    </div>

                    <div className="cbh-last">
                      {c?.lastMessage ||
                        c?.lastMessagePreview ||
                        "Sem mensagem registrada."}
                    </div>

                    <div className="cbh-meta">
                      <span className={`cbh-badge ${status}`}>
                        {status === "open" ? "Aberta" : "Encerrada"}
                      </span>

                      {/* ✅ badge do canal */}
                      <span className="cbh-badge" title={`Canal: ${channelLabel(ch)}`}>
                        {channelLabel(ch)}
                      </span>

                      <span className={`cbh-badge ${outcomeClass}`}>
                        {outcomeLabel(outcome)}
                      </span>

                      <span className="cbh-badge">
                        Bot x{Number(c?.botAttempts || 0)}
                      </span>

                      <span className="cbh-time">
                        Última atualização: {safeLocale(c?.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <div
                    className="cbh-item-actions"
                    style={{ alignSelf: "center" }}
                  >
                    <span className="cbh-chevron" aria-hidden="true">
                      ›
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Drawer */}
      {openId && (
        <div
          className="cbh-drawer-overlay"
          onClick={closeDrawer}
          role="presentation"
        >
          <aside
            className="cbh-drawer"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className="cbh-drawer-header">
              <div>
                <div className="cbh-drawer-title">
                  {openConv?.contactName || openConv?.phone || "Conversa"}
                </div>

                <div className="cbh-drawer-sub">
                  {openConv?.phone ? `Telefone: ${openConv.phone}` : ""}
                  {openConv?.updatedAt
                    ? ` • Atualizado: ${safeLocale(openConv.updatedAt)}`
                    : ""}

                  {/* ✅ canal no drawer */}
                  {openConv ? ` • Canal: ${channelLabel(normalizeChannel(openConv))}` : ""}
                </div>
              </div>

              <button
                type="button"
                className="cbh-btn cbh-btn-ghost"
                onClick={closeDrawer}
              >
                Fechar
              </button>
            </div>

            <div className="cbh-drawer-body">
              {msgLoading && (
                <div className="cbh-loading">Carregando mensagens…</div>
              )}
              {msgError && <div className="cbh-alert">{msgError}</div>}

              {!msgLoading && !msgError && messages.length === 0 && (
                <div className="cbh-empty">Sem mensagens para exibir.</div>
              )}

              {!msgLoading && !msgError && messages.length > 0 && (
                <div className="cbh-msg-list">
                  {messages.map((m, idx) => {
                    const from = String(
                      m?.from || m?.direction || m?.sender || ""
                    ).toLowerCase();

                    // heurística de "minha" = saída/atendente/humano
                    const mine =
                      from.includes("out") ||
                      from.includes("agent") ||
                      from.includes("human");

                    const ts = m?.timestamp || m?.createdAt || m?.sentAt;

                    return (
                      <div
                        key={m?.id || `${openId}-${idx}`}
                        className={`cbh-msg ${
                          mine ? "is-mine" : "is-theirs"
                        }`}
                      >
                        <div className="cbh-msg-bubble">
                          <div className="cbh-msg-text">{msgText(m)}</div>
                          <div className="cbh-msg-time">{safeLocale(ts)}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
