// frontend/src/outbound/CampaignsPage.jsx
import { useState } from "react";
import "../campaigns.css";

const MOCK_CAMPAIGNS = [
  {
    id: 1,
    name: "Campanha de Boas-vindas",
    channel: "WhatsApp",
    template: "boas_vindas",
    createdAt: "08/12/2025",
    recipients: 34,
    status: "Feito",
  },
  {
    id: 2,
    name: "Black Friday 2025",
    channel: "WhatsApp",
    template: "bf_oferta_2025",
    createdAt: "20/11/2025",
    recipients: 120,
    status: "Projeto",
  },
];

export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState("campaigns");
  const [campaignName, setCampaignName] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [scheduleDateTime, setScheduleDateTime] = useState("");
  const [internalDescription, setInternalDescription] = useState("");

  const [campaigns, setCampaigns] = useState(MOCK_CAMPAIGNS);

  function handleCreateCampaign(e) {
    e.preventDefault();

    if (!campaignName.trim() || !templateName.trim()) {
      alert("Informe pelo menos Nome da campanha e Template.");
      return;
    }

    const newCampaign = {
      id: campaigns.length ? campaigns[campaigns.length - 1].id + 1 : 1,
      name: campaignName.trim(),
      channel: "WhatsApp",
      template: templateName.trim(),
      createdAt: new Date().toLocaleDateString("pt-BR"),
      recipients: 0,
      status: scheduleDateTime ? "Agendada" : "Projeto",
      fromNumber: fromNumber.trim(),
      internalDescription: internalDescription.trim(),
      scheduleDateTime,
    };

    setCampaigns([newCampaign, ...campaigns]);

    setCampaignName("");
    setFromNumber("");
    setTemplateName("");
    setScheduleDateTime("");
    setInternalDescription("");
  }

  function renderTabContent() {
    if (activeTab === "campaigns") {
      return (
        <div className="campaigns-tab">
          {/* CARD – NOVA CAMPANHA */}
          <section className="card card-campaign-new">
            <h2 className="card-title">Nova campanha</h2>
            <p className="card-subtitle">
              Crie uma campanha vinculando um template aprovado pelo WhatsApp.
            </p>

            <form className="campaign-form" onSubmit={handleCreateCampaign}>
              <div className="campaign-form-row">
                <div className="campaign-form-group">
                  <label htmlFor="campaign-name">Nome da campanha</label>
                  <input
                    id="campaign-name"
                    type="text"
                    placeholder="Ex.: boas_vindas_lançamento"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </div>

                <div className="campaign-form-group">
                  <label htmlFor="from-number">A partir de</label>
                  <input
                    id="from-number"
                    type="text"
                    placeholder="Número de envio (opcional)"
                    value={fromNumber}
                    onChange={(e) => setFromNumber(e.target.value)}
                  />
                </div>
              </div>

              <div className="campaign-form-row">
                <div className="campaign-form-group">
                  <label htmlFor="template-name">Template</label>
                  <input
                    id="template-name"
                    type="text"
                    placeholder="Escreva para filtrar entre modelos"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                  <small className="field-hint">
                    Use o nome exatamente como está aprovado no Business
                    Manager. Ex.: <code>boas_vindas</code>
                  </small>
                </div>

                <div className="campaign-form-group">
                  <label htmlFor="schedule">Agendar (opcional)</label>
                  <input
                    id="schedule"
                    type="datetime-local"
                    value={scheduleDateTime}
                    onChange={(e) => setScheduleDateTime(e.target.value)}
                  />
                  <small className="field-hint">
                    Se vazio, a campanha ficará em &quot;Projeto&quot; para ser
                    disparada manualmente.
                  </small>
                </div>
              </div>

              <div className="campaign-form-row">
                <div className="campaign-form-group full-width">
                  <label htmlFor="description">Descrição interna</label>
                  <textarea
                    id="description"
                    rows={3}
                    placeholder="Breve descrição interna (visível apenas para sua equipe)"
                    value={internalDescription}
                    onChange={(e) => setInternalDescription(e.target.value)}
                  />
                </div>
              </div>

              <div className="campaign-form-actions">
                <button type="submit" className="btn btn-primary">
                  Criar campanha
                </button>
                <span className="campaign-form-note">
                  Depois vamos conectar esta tela ao envio real de campanhas via
                  API oficial do WhatsApp.
                </span>
              </div>
            </form>
          </section>

          {/* LISTA DE CAMPANHAS */}
          <section className="card card-campaign-list">
            <h2 className="card-title">Campanhas</h2>
            <p className="card-subtitle">
              Lista das campanhas criadas na plataforma.
            </p>

            {campaigns.length === 0 ? (
              <div className="empty-state">
                <p>Nenhuma campanha criada.</p>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="campaigns-table">
                  <thead>
                    <tr>
                      <th>Nome</th>
                      <th>Canal</th>
                      <th>Modelo</th>
                      <th>Criada em</th>
                      <th>Destinatários</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.channel}</td>
                        <td>{c.template}</td>
                        <td>{c.createdAt}</td>
                        <td>{c.recipients}</td>
                        <td>
                          <span
                            className={`status-pill status-${c.status
                              .toLowerCase()
                              .replace(" ", "-")}`}
                          >
                            {c.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      );
    }

    if (activeTab === "templates") {
      return (
        <section className="card">
          <h2 className="card-title">Templates</h2>
          <p className="card-subtitle">
            Em breve: listagem dos modelos aprovados no Business Manager, com
            status e pré-visualização.
          </p>
        </section>
      );
    }

    if (activeTab === "media") {
      return (
        <section className="card">
          <h2 className="card-title">Biblioteca de mídia</h2>
          <p className="card-subtitle">
            Em breve: upload e gestão de imagens, PDFs e vídeos para usar nas
            campanhas.
          </p>
        </section>
      );
    }

    return (
      <section className="card">
        <h2 className="card-title">Relatórios</h2>
        <p className="card-subtitle">
          Em breve: entregas, respostas, cliques e métricas das suas campanhas
          de WhatsApp.
        </p>
      </section>
    );
  }

  return (
    <div className="page campaigns-page">
      {/* 🔹 CARD DO NÚMERO CONECTADO */}
      <div className="whatsapp-number-card">
        <div className="wn-left">
          <h3>Número conectado</h3>
          <p className="wn-number">+55 64 99989-8978</p>
          <p className="wn-channel">Canal: WhatsApp Business API</p>
        </div>

        <div className="wn-right">
          <div className="wn-item">
            <span className="wn-label">Qualidade</span>
            <span className="wn-badge wn-badge-good">Alta</span>
          </div>

          <div className="wn-item">
            <span className="wn-label">Limite / 24h</span>
            <span className="wn-value">250 mensagens</span>
          </div>

          <div className="wn-item">
            <span className="wn-label">Última atualização</span>
            <span className="wn-value">08 Dez 2025</span>
          </div>
        </div>
      </div>

      {/* CABEÇALHO DA PÁGINA */}
      <header className="page-header">
        <div>
          <h1>Outbound – Campanhas WhatsApp</h1>
          <p className="page-subtitle">
            Gere campanhas, templates, biblioteca de mídia e acompanhe
            resultados.
          </p>
        </div>
      </header>

      {/* Abas internas */}
      <div className="inner-tabs">
        <button
          className={
            activeTab === "campaigns" ? "inner-tab active" : "inner-tab"
          }
          onClick={() => setActiveTab("campaigns")}
        >
          Campanhas
        </button>
        <button
          className={
            activeTab === "templates" ? "inner-tab active" : "inner-tab"
          }
          onClick={() => setActiveTab("templates")}
        >
          Templates
        </button>
        <button
          className={activeTab === "media" ? "inner-tab active" : "inner-tab"}
          onClick={() => setActiveTab("media")}
        >
          Biblioteca de mídia
        </button>
        <button
          className={
            activeTab === "reports" ? "inner-tab active" : "inner-tab"
          }
          onClick={() => setActiveTab("reports")}
        >
          Relatórios
        </button>
      </div>

      <div className="page-body">{renderTabContent()}</div>
    </div>
  );
}


