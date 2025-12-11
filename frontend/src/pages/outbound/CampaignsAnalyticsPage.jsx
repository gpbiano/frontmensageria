// frontend/src/outbound/CampaignsAnalyticsPage.jsx
export default function CampaignsAnalyticsPage() {
  return (
    <div className="page campaigns-analytics-page">
      {/* Filtros superiores */}
      <header className="page-header">
        <h1>Painel de campanhas</h1>
        <p className="page-subtitle">
          Visão geral das mensagens enviadas pelas campanhas WhatsApp.
        </p>
      </header>

      <section className="analytics-filters">
        <div className="filter-group">
          <label>Período</label>
          <div className="filter-period">
            <input type="date" />
            <span className="filter-separator">→</span>
            <input type="date" />
          </div>
        </div>

        <div className="filter-group">
          <label>Canal</label>
          <select>
            <option>Todos</option>
            <option>WhatsApp</option>
            <option>SMS</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Tipo</label>
          <select>
            <option>Todos</option>
            <option>Template</option>
            <option>Texto livre</option>
          </select>
        </div>

        <div className="filter-group">
          <label>Campanha</label>
          <select>
            <option>Todas</option>
          </select>
        </div>

        <div className="filter-actions">
          <button type="button" className="link-button">
            Limpar filtros
          </button>
          <button type="button" className="primary-button">
            Gerar relatório
          </button>
        </div>
      </section>

      {/* Cards de métricas */}
      <section className="analytics-cards">
        <div className="analytics-card">
          <span className="label">Mensagens processadas</span>
          <span className="value">0</span>
        </div>

        <div className="analytics-card">
          <span className="label">Não entregue</span>
          <span className="value">0</span>
        </div>

        <div className="analytics-card">
          <span className="label">Mensagens entregues</span>
          <span className="value">0</span>
        </div>

        <div className="analytics-card">
          <span className="label">Mensagens lidas</span>
          <span className="value">0</span>
        </div>

        <div className="analytics-card">
          <span className="label">Mensagens de erro</span>
          <span className="value">0</span>
        </div>

        <div className="analytics-card">
          <span className="label">Custo estimado</span>
          <span className="value">$0.00</span>
        </div>
      </section>

      {/* Placeholder de gráfico / tabela */}
      <section className="analytics-empty-state">
        <div className="empty-illustration" />
        <h2>Ainda não há dados para exibir</h2>
        <p>Comece criando sua primeira campanha.</p>
      </section>
    </div>
  );
}
