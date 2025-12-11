// frontend/src/pages/ChatbotHistoryPage.jsx
import "../../styles/chatbot.css";

import { useEffect, useMemo, useState } from "react";
import { fetchConversations } from "../../api.js";

/**
 * Regras:
 * - Só entram conversas com botAttempts > 0 (bot atuou em algum momento)
 * - Classificação:
 *    - "bot_resolved": status "closed" e currentMode === "bot"
 *    - "transferred": currentMode === "human"
 *    - "in_bot": status "open" e currentMode === "bot"
 */

function classifyOutcome(conv) {
  const botAttempts = conv.botAttempts || 0;
  if (botAttempts === 0) return null;

  if (conv.currentMode === "human") return "transferred";
  if (conv.status === "closed" && conv.currentMode === "bot")
    return "bot_resolved";
  if (conv.status === "open" && conv.currentMode === "bot") return "in_bot";

  return "mixed";
}

export default function ChatbotHistoryPage() {
  const [conversations, setConversations] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | closed
  const [outcomeFilter, setOutcomeFilter] = useState("all"); // all | bot_resolved | transferred | in_bot
  const [searchTerm, setSearchTerm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        // pega todas as conversas, filtro de bot é feito no front
        const data = await fetchConversations("all");
        const list = Array.isArray(data) ? data : [];

        // apenas conversas onde o bot atuou
        const withBot = list.filter((c) => (c.botAttempts || 0) > 0);
        setConversations(withBot);
      } catch (err) {
        console.error("Erro ao carregar histórico do bot:", err);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const filteredConversations = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return conversations.filter((c) => {
      const outcome = classifyOutcome(c);
      if (!outcome) return false; // não deveria acontecer, mas por segurança

      // filtro por status (open/closed/all)
      if (statusFilter !== "all" && c.status !== statusFilter) {
        return false;
      }

      // filtro por outcome (bot_resolved / transferred / in_bot / all)
      if (outcomeFilter !== "all" && outcome !== outcomeFilter) {
        return false;
      }

      // filtro de busca
      const matchesTerm =
        !term ||
        (c.contactName &&
          c.contactName.toLowerCase().includes(term)) ||
        (c.phone && c.phone.toLowerCase().includes(term)) ||
        (c.lastMessage &&
          c.lastMessage.toLowerCase().includes(term));

      return matchesTerm;
    });
  }, [conversations, statusFilter, outcomeFilter, searchTerm]);

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

  return (
    <div className="chatbot-history-layout">
      <header className="chatbot-history-header">
        <div>
          <h1>Histórico do Chatbot</h1>
          <p>
            Visão das conversas em que o bot atuou, com separação entre
            resolvidas pelo bot e transferidas para humanos.
          </p>
        </div>

        <div className="chatbot-history-stats">
          <div className="stat-card">
            <span className="stat-label">Total com bot</span>
            <span className="stat-value">{stats.total}</span>
          </div>
          <div className="stat-card stat-bot-resolved">
            <span className="stat-label">Resolvido pelo bot</span>
            <span className="stat-value">{stats.botResolved}</span>
          </div>
          <div className="stat-card stat-transferred">
            <span className="stat-label">Transferido para humano</span>
            <span className="stat-value">{stats.transferred}</span>
          </div>
          <div className="stat-card stat-in-bot">
            <span className="stat-label">Em andamento com o bot</span>
            <span className="stat-value">{stats.inBot}</span>
          </div>
        </div>
      </header>

      <section className="chatbot-history-filters">
        <input
          type="text"
          placeholder="Buscar por nome, telefone ou última mensagem..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />

        <div className="filter-group">
          <span className="filter-label">Status:</span>
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
            Abertas
          </button>
          <button
            className={statusFilter === "closed" ? "active" : ""}
            onClick={() => setStatusFilter("closed")}
          >
            Encerradas
          </button>
        </div>

        <div className="filter-group">
          <span className="filter-label">Resultado:</span>
          <button
            className={outcomeFilter === "all" ? "active" : ""}
            onClick={() => setOutcomeFilter("all")}
          >
            Todos
          </button>
          <button
            className={outcomeFilter === "bot_resolved" ? "active" : ""}
            onClick={() => setOutcomeFilter("bot_resolved")}
          >
            Resolvido pelo bot
          </button>
          <button
            className={outcomeFilter === "transferred" ? "active" : ""}
            onClick={() => setOutcomeFilter("transferred")}
          >
            Transferido para humano
          </button>
          <button
            className={outcomeFilter === "in_bot" ? "active" : ""}
            onClick={() => setOutcomeFilter("in_bot")}
          >
            Em andamento com o bot
          </button>
        </div>
      </section>

      <section className="chatbot-history-list">
        {loading && (
          <div className="chatbot-history-empty">
            Carregando histórico do bot...
          </div>
        )}

        {!loading && filteredConversations.length === 0 && (
          <div className="chatbot-history-empty">
            Nenhuma conversa encontrada com os filtros atuais.
          </div>
        )}

        {!loading &&
          filteredConversations.map((c) => {
            const outcome = classifyOutcome(c);
            let outcomeLabel = "";
            if (outcome === "bot_resolved") outcomeLabel = "Resolvido pelo bot";
            else if (outcome === "transferred")
              outcomeLabel = "Transferido para humano";
            else if (outcome === "in_bot")
              outcomeLabel = "Em andamento com o bot";
            else outcomeLabel = "Misto";

            return (
              <article key={c.id} className="chatbot-history-item">
                <header className="chatbot-history-item-header">
                  <div>
                    <div className="chatbot-history-contact-name">
                      {c.contactName || c.phone}
                    </div>
                    <div className="chatbot-history-phone">{c.phone}</div>
                  </div>
                  <div className="chatbot-history-tags">
                    <span className={`tag status-${c.status}`}>
                      {c.status === "open" ? "Aberta" : "Encerrada"}
                    </span>
                    <span className={`tag outcome-${outcome}`}>
                      {outcomeLabel}
                    </span>
                    <span className="tag bot-attempts">
                      Bot x{c.botAttempts || 0}
                    </span>
                  </div>
                </header>

                <div className="chatbot-history-last-message">
                  {c.lastMessage || "Sem mensagem registrada."}
                </div>

                <footer className="chatbot-history-meta">
                  <span>
                    Última atualização:{" "}
                    {c.updatedAt
                      ? new Date(c.updatedAt).toLocaleString()
                      : "—"}
                  </span>
                  {/* espaço para futuras métricas: tempo de atendimento, NPS, etc */}
                </footer>
              </article>
            );
          })}
      </section>
    </div>
  );
}
