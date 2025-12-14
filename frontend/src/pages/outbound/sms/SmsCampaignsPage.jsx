import { useEffect, useState } from "react";
import {
  fetchSmsCampaigns,
  fetchSmsCampaignReport
} from "../../../api";
import SmsCampaignCreateWizard from "./SmsCampaignCreateWizard.jsx";
import "../../../styles/campaigns.css";

export default function SmsCampaignsPage({ onExit }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchSmsCampaigns();
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function openReport(camp) {
    setSelected(camp);
    setReport(null);
    const r = await fetchSmsCampaignReport(camp.id);
    setReport(r);
  }

  useEffect(() => {
    load();
  }, []);

  if (creating) {
    return (
      <div className="campaigns-page">
        <div className="campaigns-header">
          <div>
            <h2>Campanhas de SMS</h2>
            <p className="muted">Crie, importe audiência e dispare via IAGENTE.</p>
          </div>
          <div className="campaigns-actions">
            <button className="btn secondary" onClick={() => setCreating(false)}>
              Voltar
            </button>
          </div>
        </div>

        <SmsCampaignCreateWizard
          onExit={() => {
            setCreating(false);
            load();
          }}
        />
      </div>
    );
  }

  return (
    <div className="campaigns-page">
      <div className="campaigns-header">
        <div>
          <h2>Campanhas de SMS</h2>
          <p className="muted">Envio de SMS integrado via IAGENTE.</p>
        </div>

        <div className="campaigns-actions">
          <button className="btn secondary" onClick={load} disabled={loading}>
            Atualizar
          </button>
          <button className="btn primary" onClick={() => setCreating(true)}>
            Nova campanha
          </button>
          {onExit ? (
            <button className="btn ghost" onClick={onExit}>
              Sair
            </button>
          ) : null}
        </div>
      </div>

      <div className="campaigns-grid">
        <div className="campaigns-card">
          <h3>Lista</h3>

          {loading ? (
            <p className="muted">Carregando...</p>
          ) : !items.length ? (
            <p className="muted">Nenhuma campanha criada ainda.</p>
          ) : (
            <div className="campaigns-table">
              <div className="campaigns-row head">
                <div>Nome</div>
                <div>Status</div>
                <div>Audiência</div>
                <div>Criada</div>
                <div></div>
              </div>

              {items.map((c) => (
                <div className="campaigns-row" key={c.id}>
                  <div className="truncate">{c.name}</div>
                  <div>
                    <span className={`pill ${c.status}`}>{c.status}</span>
                  </div>
                  <div>{c.audienceCount || 0}</div>
                  <div className="muted">{(c.createdAt || "").slice(0, 19).replace("T", " ")}</div>
                  <div style={{ textAlign: "right" }}>
                    <button className="btn small" onClick={() => openReport(c)}>
                      Ver relatório
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="campaigns-card">
          <h3>Relatório</h3>

          {!selected ? (
            <p className="muted">Selecione uma campanha para ver os resultados.</p>
          ) : !report ? (
            <p className="muted">Carregando relatório...</p>
          ) : (
            <>
              <div className="stats">
                <div className="stat">
                  <div className="label">Total</div>
                  <div className="value">{report.total}</div>
                </div>
                <div className="stat">
                  <div className="label">Enviados</div>
                  <div className="value">{report.sent}</div>
                </div>
                <div className="stat">
                  <div className="label">Falhas</div>
                  <div className="value">{report.failed}</div>
                </div>
                <div className="stat">
                  <div className="label">Status</div>
                  <div className="value">{report.status}</div>
                </div>
              </div>

              <div style={{ marginTop: 12 }} className="campaigns-table">
                <div className="campaigns-row head">
                  <div>Telefone</div>
                  <div>Status</div>
                  <div>Retorno</div>
                </div>

                {(report.results || []).slice(0, 200).map((r, idx) => (
                  <div className="campaigns-row" key={`${r.codeSms}_${idx}`}>
                    <div className="truncate">{r.phone}</div>
                    <div>
                      <span className={`pill ${r.status}`}>{r.status}</span>
                    </div>
                    <div className="truncate muted">{r.providerRaw || r.error || "-"}</div>
                  </div>
                ))}
              </div>

              {Array.isArray(report.results) && report.results.length > 200 ? (
                <p className="muted" style={{ marginTop: 10 }}>
                  Mostrando os primeiros 200 resultados.
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
