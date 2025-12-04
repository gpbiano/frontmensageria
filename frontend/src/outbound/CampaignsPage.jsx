// frontend/src/outbound/CampaignsPage.jsx
import { useEffect, useState, useMemo } from "react";
import {
  fetchCampaigns,
  fetchTemplates,
  fetchMediaLibrary,
  createCampaign,
  createTemplate,
  createMediaItem,
} from "../api";

export default function CampaignsPage() {
  const [activeTab, setActiveTab] = useState("campaigns");

  const [campaigns, setCampaigns] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [mediaItems, setMediaItems] = useState([]);

  // Form campanha
  const [campaignName, setCampaignName] = useState("");
  const [campaignTemplateId, setCampaignTemplateId] = useState("");
  const [campaignScheduledAt, setCampaignScheduledAt] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [creatingCampaign, setCreatingCampaign] = useState(false);

  // Form template
  const [templateName, setTemplateName] = useState("");
  const [templateBody, setTemplateBody] = useState("");
  const [creatingTemplate, setCreatingTemplate] = useState(false);

  // Form mídia (URL)
  const [mediaLabel, setMediaLabel] = useState("");
  const [mediaType, setMediaType] = useState("image");
  const [mediaUrl, setMediaUrl] = useState("");
  const [creatingMedia, setCreatingMedia] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      const [camps, temps, media] = await Promise.all([
        fetchCampaigns(),
        fetchTemplates(),
        fetchMediaLibrary(),
      ]);

      setCampaigns(Array.isArray(camps) ? camps : []);
      setTemplates(Array.isArray(temps) ? temps : []);
      setMediaItems(Array.isArray(media) ? media : []);
    } catch (err) {
      console.error("Erro ao carregar dados do outbound:", err);
    }
  }

  // ===============================
  // CAMPANHAS
  // ===============================

  async function handleCreateCampaign(e) {
    e.preventDefault();
    if (!campaignName || !campaignTemplateId) return;

    try {
      setCreatingCampaign(true);
      await createCampaign({
        name: campaignName,
        templateId: Number(campaignTemplateId),
        scheduledAt: campaignScheduledAt || null,
        description: campaignDescription || "",
      });

      setCampaignName("");
      setCampaignTemplateId("");
      setCampaignScheduledAt("");
      setCampaignDescription("");
      await loadAll();
    } catch (err) {
      console.error("Erro ao criar campanha:", err);
      alert("Erro ao criar campanha. Veja o console para detalhes.");
    } finally {
      setCreatingCampaign(false);
    }
  }

  // ===============================
  // TEMPLATES
  // ===============================

  async function handleCreateTemplate(e) {
    e.preventDefault();
    if (!templateName || !templateBody) return;

    try {
      setCreatingTemplate(true);
      await createTemplate({
        name: templateName,
        body: templateBody,
        type: "text",
      });

      setTemplateName("");
      setTemplateBody("");
      await loadAll();
    } catch (err) {
      console.error("Erro ao criar template:", err);
      alert("Erro ao criar template. Veja o console para detalhes.");
    } finally {
      setCreatingTemplate(false);
    }
  }

  // ===============================
  // MÍDIA (via URL)
  // ===============================

  async function handleCreateMedia(e) {
    e.preventDefault();
    if (!mediaLabel || !mediaUrl) return;

    try {
      setCreatingMedia(true);
      await createMediaItem({
        label: mediaLabel,
        type: mediaType,
        url: mediaUrl,
      });

      setMediaLabel("");
      setMediaType("image");
      setMediaUrl("");
      await loadAll();
    } catch (err) {
      console.error("Erro ao cadastrar mídia:", err);
      alert("Erro ao cadastrar mídia. Veja o console para detalhes.");
    } finally {
      setCreatingMedia(false);
    }
  }

  // ===============================
  // RELATÓRIO (calculado no front)
  // ===============================

  const report = useMemo(() => {
    const total = campaigns.length;

    const byStatus = campaigns.reduce(
      (acc, c) => {
        const status = (c.status || "unknown").toLowerCase();
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      /** @type {Record<string, number>} */ ({})
    );

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const last7Days = campaigns.filter((c) => {
      if (!c.createdAt) return false;
      const d = new Date(c.createdAt);
      return d >= sevenDaysAgo && d <= now;
    });

    const lastCampaigns = [...campaigns]
      .filter((c) => c.createdAt)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 5);

    return {
      total,
      byStatus,
      last7DaysCount: last7Days.length,
      lastCampaigns,
    };
  }, [campaigns]);

  // ===============================
  // RENDER
  // ===============================

  return (
    <div className="outbound-page">
      <div className="outbound-header">
        <h1>Outbound – Campanhas WhatsApp</h1>
        <p>
          Gerencie campanhas, templates, biblioteca de mídia e acompanhe
          resultados.
        </p>
      </div>

      {/* Abas internas */}
      <div className="outbound-tabs">
        <button
          className={activeTab === "campaigns" ? "active" : ""}
          onClick={() => setActiveTab("campaigns")}
        >
          Campanhas
        </button>
        <button
          className={activeTab === "templates" ? "active" : ""}
          onClick={() => setActiveTab("templates")}
        >
          Templates
        </button>
        <button
          className={activeTab === "media" ? "active" : ""}
          onClick={() => setActiveTab("media")}
        >
          Biblioteca de mídia
        </button>
        <button
          className={activeTab === "reports" ? "active" : ""}
          onClick={() => setActiveTab("reports")}
        >
          Relatórios
        </button>
      </div>

      {/* CAMPANHAS */}
      {activeTab === "campaigns" && (
        <div className="outbound-section">
          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Nova campanha</h2>
                <p>Crie uma campanha vinculando um template.</p>
              </div>
            </div>

            <form onSubmit={handleCreateCampaign}>
              <div className="outbound-form-grid">
                <div className="outbound-form-field">
                  <label>Nome da campanha</label>
                  <input
                    type="text"
                    placeholder="Ex.: boas_vindas"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                  />
                </div>

                <div className="outbound-form-field">
                  <label>Template</label>
                  <select
                    value={campaignTemplateId}
                    onChange={(e) => setCampaignTemplateId(e.target.value)}
                  >
                    <option value="">Selecione</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="outbound-form-field">
                  <label>Agendar (opcional)</label>
                  <input
                    type="datetime-local"
                    value={campaignScheduledAt}
                    onChange={(e) => setCampaignScheduledAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="outbound-form-field" style={{ maxWidth: 520 }}>
                <label>Descrição interna</label>
                <textarea
                  placeholder="Breve descrição interna"
                  value={campaignDescription}
                  onChange={(e) => setCampaignDescription(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={creatingCampaign}
              >
                {creatingCampaign ? "Criando..." : "Criar campanha"}
              </button>
            </form>
          </div>

          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Campanhas</h2>
                <p>Lista das campanhas criadas.</p>
              </div>
            </div>

            {campaigns.length === 0 ? (
              <div className="outbound-empty">Nenhuma campanha criada.</div>
            ) : (
              <table className="outbound-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Template</th>
                    <th>Status</th>
                    <th>Criada em</th>
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const temp = templates.find((t) => t.id === c.templateId);
                    return (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>{c.name}</td>
                        <td>{temp ? temp.name : `#${c.templateId}`}</td>
                        <td>
                          <span className="outbound-status-pill">
                            {c.status}
                          </span>
                        </td>
                        <td>
                          {c.createdAt
                            ? new Date(c.createdAt).toLocaleString("pt-BR")
                            : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* TEMPLATES */}
      {activeTab === "templates" && (
        <div className="outbound-section">
          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Novo template</h2>
                <p>Crie um modelo de mensagem para usar nas campanhas.</p>
              </div>
            </div>

            <form onSubmit={handleCreateTemplate}>
              <div className="outbound-form-grid">
                <div className="outbound-form-field">
                  <label>Nome do template</label>
                  <input
                    type="text"
                    placeholder="Ex.: boas_vindas_texto"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                  />
                </div>

                <div className="outbound-form-field">
                  <label>Tipo</label>
                  <input value="Texto" disabled />
                </div>
              </div>

              <div className="outbound-form-field">
                <label>Corpo da mensagem</label>
                <textarea
                  placeholder="Olá {{nome}}, seja bem-vindo(a) ao Criatório Peres!"
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={creatingTemplate}
              >
                {creatingTemplate ? "Criando..." : "Criar template"}
              </button>
            </form>
          </div>

          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Templates</h2>
                <p>Templates disponíveis para uso nas campanhas.</p>
              </div>
            </div>

            {templates.length === 0 ? (
              <div className="outbound-empty">
                Nenhum template cadastrado ainda.
              </div>
            ) : (
              <table className="outbound-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Nome</th>
                    <th>Corpo</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((t) => (
                    <tr key={t.id}>
                      <td>{t.id}</td>
                      <td>{t.name}</td>
                      <td style={{ maxWidth: 320 }}>{t.body}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* BIBLIOTECA DE MÍDIA (URL) */}
      {activeTab === "media" && (
        <div className="outbound-section">
          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Nova mídia</h2>
                <p>Cadastre URLs de imagens, vídeos ou documentos.</p>
              </div>
            </div>

            <form onSubmit={handleCreateMedia}>
              <div className="outbound-form-grid">
                <div className="outbound-form-field">
                  <label>Nome / rótulo</label>
                  <input
                    type="text"
                    placeholder="Ex.: Banner lançamento"
                    value={mediaLabel}
                    onChange={(e) => setMediaLabel(e.target.value)}
                  />
                </div>

                <div className="outbound-form-field">
                  <label>Tipo</label>
                  <select
                    value={mediaType}
                    onChange={(e) => setMediaType(e.target.value)}
                  >
                    <option value="image">Imagem</option>
                    <option value="video">Vídeo</option>
                    <option value="document">Documento</option>
                  </select>
                </div>

                <div className="outbound-form-field">
                  <label>URL da mídia</label>
                  <input
                    type="text"
                    placeholder="https://..."
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={creatingMedia}
              >
                {creatingMedia ? "Salvando..." : "Cadastrar mídia"}
              </button>
            </form>
          </div>

          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Biblioteca de mídia</h2>
                <p>Itens cadastrados para uso em templates e campanhas.</p>
              </div>
            </div>

            {mediaItems.length === 0 ? (
              <div className="outbound-empty">
                Nenhuma mídia cadastrada ainda.
              </div>
            ) : (
              <div className="media-grid">
                {mediaItems.map((m) => (
                  <div key={m.id} className="media-card">
                    {m.type === "image" && m.url ? (
                      <img
                        src={m.url}
                        alt={m.label}
                        className="media-card-thumb"
                      />
                    ) : (
                      <div
                        className="media-card-thumb"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          color: "#9ca3af",
                          background:
                            "linear-gradient(135deg, #0f172a, #020617)",
                        }}
                      >
                        {m.type.toUpperCase()}
                      </div>
                    )}
                    <div className="media-card-label">{m.label}</div>
                    <div className="media-card-meta">
                      {m.type} • {m.url}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* RELATÓRIOS */}
      {activeTab === "reports" && (
        <div className="outbound-section">
          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Visão geral das campanhas</h2>
                <p>
                  Indicadores calculados a partir das campanhas existentes na
                  plataforma.
                </p>
              </div>
            </div>

            <div className="report-grid">
              <div className="kpi-card">
                <span className="kpi-label">Total de campanhas</span>
                <span className="kpi-value">{report.total}</span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Últimos 7 dias</span>
                <span className="kpi-value">{report.last7DaysCount}</span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Ativas / abertas</span>
                <span className="kpi-value">
                  {report.byStatus["open"] || 0}
                </span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Agendadas</span>
                <span className="kpi-value">
                  {report.byStatus["scheduled"] || 0}
                </span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Enviadas / concluídas</span>
                <span className="kpi-value">
                  {report.byStatus["sent"] || report.byStatus["completed"] || 0}
                </span>
              </div>

              <div className="kpi-card">
                <span className="kpi-label">Falhas</span>
                <span className="kpi-value">
                  {report.byStatus["failed"] || 0}
                </span>
              </div>
            </div>
          </div>

          <div className="outbound-card">
            <div className="outbound-card-header">
              <div>
                <h2>Últimas campanhas criadas</h2>
                <p>As 5 campanhas mais recentes.</p>
              </div>
            </div>

            {report.lastCampaigns.length === 0 ? (
              <div className="outbound-empty">
                Nenhuma campanha criada ainda.
              </div>
            ) : (
              <table className="outbound-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Status</th>
                    <th>Criada em</th>
                    <th>Template</th>
                  </tr>
                </thead>
                <tbody>
                  {report.lastCampaigns.map((c) => {
                    const temp = templates.find((t) => t.id === c.templateId);
                    return (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>
                          <span className="outbound-status-pill">
                            {c.status}
                          </span>
                        </td>
                        <td>
                          {c.createdAt
                            ? new Date(c.createdAt).toLocaleString("pt-BR")
                            : "-"}
                        </td>
                        <td>{temp ? temp.name : `#${c.templateId}`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

