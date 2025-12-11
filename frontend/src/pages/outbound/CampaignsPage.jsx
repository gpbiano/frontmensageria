// frontend/src/outbound/CampaignsPage.jsx
import { useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

export default function CampaignsPage() {
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("");
  const [parameters, setParameters] = useState("");
  const [targets, setTargets] = useState("");
  const [description, setDescription] = useState("");

  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSendCampaign(e) {
    e.preventDefault();
    setLoading(true);
    setStatus(null);

    const payload = {
      name,
      template,
      parameters: parameters
        .split("\n")
        .map((p) => p.trim())
        .filter(Boolean),
      targets: targets
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean),
      description
    };

    try {
      const res = await fetch(`${API_BASE}/outbound/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);
      setStatus(data || { success: true });
    } catch (err) {
      console.error(err);
      setStatus({ error: "Erro ao enviar campanha." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page campaigns-page">
      <header className="page-header">
        <h1>Campanhas WhatsApp</h1>
        <p className="page-subtitle">
          Configure e envie campanhas utilizando templates aprovados na API
          WhatsApp Cloud.
        </p>
      </header>

      <section className="card campaign-card">
        <h2 className="card-title">Nova campanha</h2>
        <p className="card-subtitle">
          Preencha os dados abaixo para disparar uma nova campanha para sua base
          de contatos.
        </p>

        <form className="campaign-form" onSubmit={handleSendCampaign}>
          <div className="campaign-form-grid">
            <div className="form-group">
              <label>Nome da campanha</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex.: Boas-vindas clientes dezembro"
              />
            </div>

            <div className="form-group">
              <label>Template (nome exato aprovado na Meta)</label>
              <input
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                placeholder="Ex.: boasvindas_clientes"
              />
            </div>

            <div className="form-group form-group-full">
              <label>
                Parâmetros do template{" "}
                <span className="hint">
                  (um por linha, na mesma ordem dos placeholders)
                </span>
              </label>
              <textarea
                rows={4}
                value={parameters}
                onChange={(e) => setParameters(e.target.value)}
                placeholder={
                  "Ex.: \nJoão\nPlano Premium\nVencimento 10/12/2025\n..."
                }
              />
            </div>

            <div className="form-group form-group-full">
              <label>
                Telefones de destino{" "}
                <span className="hint">
                  (um por linha, com DDI + DDD + número, apenas dígitos)
                </span>
              </label>
              <textarea
                rows={4}
                value={targets}
                onChange={(e) => setTargets(e.target.value)}
                placeholder={"5564999999999\n5564998888888"}
              />
            </div>

            <div className="form-group form-group-full">
              <label>Descrição interna</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex.: Disparo de boas-vindas para novos leads do formulário do site."
              />
            </div>
          </div>

          <div className="form-actions right">
            <button
              type="submit"
              className="primary-button"
              disabled={loading}
            >
              {loading ? "Enviando campanha..." : "Enviar campanha"}
            </button>
          </div>
        </form>
      </section>

      {status && (
        <section className="card result-card">
          <div className="result-header">
            <h2 className="card-title">Resultados do envio</h2>
            {status.success && !status.error && (
              <span className="badge badge-success">Sucesso</span>
            )}
            {status.error && (
              <span className="badge badge-error">Erro</span>
            )}
          </div>

          <pre className="result-json">
            {JSON.stringify(status, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
