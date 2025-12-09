// frontend/src/outbound/TemplatesPage.jsx
import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

const INITIAL_FORM = {
  name: "",
  category: "marketing",
  language: "pt_BR",
  previewType: "text", // "text" | "text_button"
  body: "",
  footer: "",
  buttonsType: "none", // "none" | "quick_reply" | "url" | "phone"
  buttonsLabel: "",
  buttonsValue: ""
};

const VARIABLE_TOKENS = [
  { key: "nome", label: "Nome do cliente", token: "{{nome}}" },
  { key: "pedido", label: "Número do pedido", token: "{{pedido}}" },
  { key: "empresa", label: "Nome da empresa", token: "{{empresa}}" },
  { key: "data", label: "Data", token: "{{data}}" }
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // criação
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [saving, setSaving] = useState(false);

  // ===========================
  // LOAD / SYNC (AUTO)
  // ===========================
  async function loadTemplates({ withAutoSync = false } = {}) {
    try {
      setLoading(true);
      setError("");

      // Auto-sync silencioso com a Meta (best effort)
      if (withAutoSync) {
        try {
          await fetch(`${API_BASE}/outbound/templates/sync`, {
            method: "POST"
          });
        } catch (err) {
          console.warn("Falha no auto-sync com a Meta (ignorado):", err);
        }
      }

      const resp = await fetch(`${API_BASE}/outbound/templates`);
      if (!resp.ok) {
        throw new Error("Erro ao carregar templates");
      }

      const data = await resp.json();
      const list = Array.isArray(data.templates) ? data.templates : data;
      setTemplates(list || []);
    } catch (err) {
      console.error(err);
      setError("Não foi possível carregar os templates. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    try {
      setSyncing(true);
      setError("");

      const resp = await fetch(`${API_BASE}/outbound/templates/sync`, {
        method: "POST"
      });

      if (!resp.ok) {
        throw new Error("Erro ao sincronizar templates com a Meta");
      }

      await resp.json().catch(() => ({})); // não usamos o retorno agora
      await loadTemplates(); // recarrega lista já atualizada
      alert("Templates sincronizados com sucesso ✅");
    } catch (err) {
      console.error(err);
      setError("Erro ao sincronizar templates com a Meta.");
      alert("Erro ao sincronizar templates com a Meta.");
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // carrega já tentando auto-sincronizar em background
    loadTemplates({ withAutoSync: true });
  }, []);

  // ===========================
  // FILTRO EM MEMÓRIA
  // ===========================
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      const term = searchTerm.trim().toLowerCase();

      if (term) {
        const haystack = `${tpl.name || ""} ${tpl.language || ""}${
          tpl.category || ""
        }`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }

      if (statusFilter !== "all") {
        const status = (tpl.status || "").toLowerCase();
        if (statusFilter === "approved" && status !== "approved") return false;
        if (statusFilter === "pending" && status !== "pending") return false;
        if (statusFilter === "rejected" && status !== "rejected") return false;
      }

      if (categoryFilter !== "all") {
        const cat = (tpl.category || "").toLowerCase();
        if (cat !== categoryFilter) return false;
      }

      return true;
    });
  }, [templates, searchTerm, statusFilter, categoryFilter]);

  // ===========================
  // CRIAÇÃO – FORM
  // ===========================
  function openCreateModal() {
    setForm(INITIAL_FORM);
    setShowCreateModal(true);
  }

  function closeCreateModal() {
    if (saving) return;
    setShowCreateModal(false);
  }

  function handleFormChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function handleInsertToken(field, token) {
    setForm((prev) => ({
      ...prev,
      [field]: `${prev[field] || ""}${prev[field] ? " " : ""}${token}`
    }));
  }

  async function handleCreateTemplate(e) {
    e.preventDefault();

    if (!form.name.trim()) {
      alert("Informe o nome interno do template.");
      return;
    }
    if (!form.body.trim()) {
      alert("Informe o corpo da mensagem.");
      return;
    }

    try {
      setSaving(true);
      setError("");

      const payload = {
        name: form.name.trim(),
        channel: "whatsapp",
        category: form.category,
        language: form.language,
        previewType: form.previewType,
        body: form.body,
        footer: form.footer,
        buttonsType: form.buttonsType,
        buttons: {
          label: form.buttonsLabel,
          value: form.buttonsValue
        }
      };

      const resp = await fetch(`${API_BASE}/outbound/templates`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        console.error("Erro ao criar template", data);
        throw new Error(data.error || "Erro ao criar template");
      }

      await resp.json().catch(() => ({}));
      await loadTemplates();
      setShowCreateModal(false);
      setForm(INITIAL_FORM);
      alert(
        "Template criado na plataforma. Lembre de homologar na Meta para uso em produção. ✅"
      );
    } catch (err) {
      console.error(err);
      setError(err.message || "Erro ao criar template.");
      alert("Erro ao criar template.");
    } finally {
      setSaving(false);
    }
  }

  // ===========================
  // PREVIEW DO TEMPLATE
  // ===========================
  function buildPreviewText(text) {
    if (!text) return "";
    // Apenas substitui visualmente as variáveis por exemplos
    return text
      .replace(/\{\{nome\}\}/gi, "João")
      .replace(/\{\{pedido\}\}/gi, "#1234")
      .replace(/\{\{empresa\}\}/gi, "GP Labs")
      .replace(/\{\{data\}\}/gi, "09/12/2025");
  }

  const previewBody = buildPreviewText(
    form.body ||
      "Olá {{nome}}, tudo bem? Esta é uma prévia da sua mensagem de template."
  );

  // ===========================
  // RENDER
  // ===========================
  return (
    <div className="page templates-page">
      <header className="page-header">
        <div>
          <h1>Templates</h1>
          <p className="page-subtitle">
            Gerencie os modelos de mensagem aprovados pela Meta para uso em
            campanhas e notificações.
          </p>
        </div>

        <button
          className="primary-btn"
          type="button"
          onClick={handleSync}
          disabled={syncing}
        >
          {syncing ? "Sincronizando..." : "Sincronizar com a Meta"}
        </button>
      </header>

      <section className="templates-toolbar">
        <div className="templates-search-wrapper">
          <span className="search-icon">🔍</span>
          <input
            className="templates-search-input"
            type="text"
            placeholder="Buscar por nome do template..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        <div className="templates-toolbar-right">
          <div className="templates-filter">
            <label>Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">todos</option>
              <option value="approved">aprovado</option>
              <option value="pending">pendente</option>
              <option value="rejected">rejeitado</option>
            </select>
          </div>

          <div className="templates-filter">
            <label>Categoria:</label>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="all">todas</option>
              <option value="marketing">marketing</option>
              <option value="utility">utilitário</option>
              <option value="authentication">autenticação</option>
            </select>
          </div>

          <button
            type="button"
            className="primary-btn primary-btn-small"
            onClick={openCreateModal}
          >
            + Criar template
          </button>
        </div>
      </section>

      <section className="templates-table-card">
        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p>Carregando templates...</p>
        ) : (
          <>
            {filteredTemplates.length === 0 ? (
              <p className="empty-text">
                Nenhum template cadastrado ainda. Clique em{" "}
                <strong>“+ Criar template”</strong> ou sincronize com a Meta.
              </p>
            ) : (
              <table className="templates-table">
                <thead>
                  <tr>
                    <th>Nome</th>
                    <th>Canal</th>
                    <th>Categoria</th>
                    <th>Visualização</th>
                    <th>Criação</th>
                    <th>Idioma</th>
                    <th>Status</th>
                    <th className="col-acoes">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTemplates.map((tpl) => (
                    <tr key={tpl.id || tpl.name}>
                      <td>{tpl.name}</td>
                      <td>{tpl.channel || "WhatsApp"}</td>
                      <td>{tpl.categoryLabel || tpl.category || "-"}</td>
                      <td>{tpl.previewTypeLabel || tpl.previewType || "-"}</td>
                      <td>{tpl.createdAtFormatted || tpl.createdAt || "-"}</td>
                      <td>{tpl.languageLabel || tpl.language || "-"}</td>
                      <td>
                        <span
                          className={`status-pill status-${(
                            tpl.status || "unknown"
                          ).toLowerCase()}`}
                        >
                          {tpl.statusLabel || tpl.status || "—"}
                        </span>
                      </td>
                      <td className="col-acoes">
                        <button
                          type="button"
                          className="icon-table-btn"
                          title="Editar"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          className="icon-table-btn"
                          title="Pré-visualizar"
                        >
                          📄
                        </button>
                        <button
                          type="button"
                          className="icon-table-btn"
                          title="Duplicar"
                        >
                          📑
                        </button>
                        <button
                          type="button"
                          className="icon-table-btn danger"
                          title="Excluir"
                        >
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </section>

      {/* MODAL DE CRIAÇÃO */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={closeCreateModal}>
          <div
            className="modal-card template-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal-header">
              <h2>Novo template de WhatsApp</h2>
              <p>
                Crie o modelo básico aqui na plataforma. A homologação oficial
                ainda deve ser feita na Meta Business (por enquanto).
              </p>
            </header>

            <form className="modal-body template-modal-layout" onSubmit={handleCreateTemplate}>
              {/* COLUNA ESQUERDA – FORM */}
              <div className="template-form-column">
                <div className="form-row">
                  <label>
                    Nome interno do template*
                    <input
                      name="name"
                      type="text"
                      value={form.name}
                      onChange={handleFormChange}
                      placeholder="ex.: boas_vindas_gp_labs"
                    />
                  </label>
                </div>

                <div className="form-row form-row-inline">
                  <label>
                    Categoria
                    <select
                      name="category"
                      value={form.category}
                      onChange={handleFormChange}
                    >
                      <option value="marketing">Marketing</option>
                      <option value="utility">Utilitário</option>
                      <option value="authentication">Autenticação</option>
                    </select>
                  </label>

                  <label>
                    Idioma
                    <select
                      name="language"
                      value={form.language}
                      onChange={handleFormChange}
                    >
                      <option value="pt_BR">Português (BR)</option>
                      <option value="en_US">Inglês (EN)</option>
                      <option value="es_ES">Espanhol (ES)</option>
                    </select>
                  </label>

                  <label>
                    Visualização
                    <select
                      name="previewType"
                      value={form.previewType}
                      onChange={handleFormChange}
                    >
                      <option value="text">Texto</option>
                      <option value="text_button">Texto + botão</option>
                    </select>
                  </label>
                </div>

                <div className="form-row">
                  <label>
                    Corpo da mensagem*
                    <textarea
                      name="body"
                      rows={4}
                      value={form.body}
                      onChange={handleFormChange}
                      placeholder="Olá {{nome}}, seja bem-vindo(a) à GP Labs..."
                    />
                  </label>

                  <div className="variable-chips">
                    <span>Inserir variáveis:</span>
                    {VARIABLE_TOKENS.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleInsertToken("body", v.token)}
                      >
                        {v.token}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <label>
                    Rodapé (opcional)
                    <input
                      name="footer"
                      type="text"
                      maxLength={60}
                      value={form.footer}
                      onChange={handleFormChange}
                      placeholder="Você pode sair da lista quando quiser."
                    />
                  </label>

                  <div className="variable-chips">
                    <span>Variáveis no rodapé:</span>
                    {VARIABLE_TOKENS.map((v) => (
                      <button
                        key={v.key}
                        type="button"
                        className="chip-btn"
                        onClick={() => handleInsertToken("footer", v.token)}
                      >
                        {v.token}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="form-row">
                  <label>
                    Botões (opcional)
                    <select
                      name="buttonsType"
                      value={form.buttonsType}
                      onChange={handleFormChange}
                    >
                      <option value="none">Sem botões</option>
                      <option value="quick_reply">Resposta rápida</option>
                      <option value="url">Acessar URL</option>
                      <option value="phone">Ligar para telefone</option>
                    </select>
                  </label>
                </div>

                {form.buttonsType !== "none" && (
                  <div className="form-row form-row-inline">
                    <label>
                      Rótulo do botão
                      <input
                        name="buttonsLabel"
                        type="text"
                        value={form.buttonsLabel}
                        onChange={handleFormChange}
                        placeholder="ex.: Ver detalhes"
                      />
                    </label>

                    <label>
                      Valor
                      <input
                        name="buttonsValue"
                        type="text"
                        value={form.buttonsValue}
                        onChange={handleFormChange}
                        placeholder={
                          form.buttonsType === "url"
                            ? "https://seusite.com/oferta"
                            : form.buttonsType === "phone"
                            ? "+556499999999"
                            : "Texto da resposta rápida"
                        }
                      />
                    </label>
                  </div>
                )}

                <footer className="modal-footer">
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={closeCreateModal}
                    disabled={saving}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="primary-btn"
                    disabled={saving}
                  >
                    {saving ? "Salvando..." : "Salvar template"}
                  </button>
                </footer>
              </div>

              {/* COLUNA DIREITA – PREVIEW */}
              <aside className="template-preview-column">
                <div className="template-preview-card">
                  <div className="template-preview-header">
                    <span className="template-preview-title">
                      Pré-visualização WhatsApp
                    </span>
                    <span className="template-preview-badge">
                      {form.language === "pt_BR"
                        ? "Português"
                        : form.language === "en_US"
                        ? "Inglês"
                        : "Espanhol"}
                    </span>
                  </div>

                  <div className="template-preview-bubble">
                    <p className="template-preview-body-text">{previewBody}</p>
                    {form.footer && (
                      <p className="template-preview-footer">{form.footer}</p>
                    )}
                  </div>

                  {form.buttonsType !== "none" && form.buttonsLabel && (
                    <div className="template-preview-buttons">
                      <button
                        type="button"
                        className="template-preview-button"
                      >
                        {form.buttonsLabel}
                      </button>
                    </div>
                  )}

                  <p className="template-preview-hint">
                    As variáveis como{" "}
                    <code className="inline-code">{"{{nome}}"}</code>{" "}
                    serão preenchidas automaticamente com os dados reais do
                    cliente na hora do envio.
                  </p>
                </div>
              </aside>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
