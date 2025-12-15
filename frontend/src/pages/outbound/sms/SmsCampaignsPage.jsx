// frontend/src/pages/outbound/sms/SmsCampaignsPage.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { fetchSmsCampaigns, fetchSmsCampaignReport } from "../../../api";
import SmsCampaignCreateWizard from "./SmsCampaignCreateWizard.jsx";
import "../../../styles/campaigns.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

export default function SmsCampaignsPage({ onExit }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  const pollRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchSmsCampaigns();
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function openReport(camp) {
    setSelected(camp);
    setReport(null);
    setReportError("");
    stopPolling();

    async function loadReport() {
      setReportLoading(true);
      setReportError("");
      try {
        const r = await fetchSmsCampaignReport(camp.id);
        setReport(r);

        if (r?.status && r.status !== "running") {
          stopPolling();
        }
      } catch (e) {
        setReportError(e?.message || "Erro ao carregar relatório.");
        stopPolling();
      } finally {
        setReportLoading(false);
      }
    }

    await loadReport();
    pollRef.current = setInterval(loadReport, 2000);
  }

  useEffect(() => {
    load();
    return () => stopPolling();
  }, []);

  const csvDownloadUrl = useMemo(() => {
    if (!selected?.id) return null;
    return `${API_BASE}/outbound/sms-campaigns/${selected.id}/report.csv`;
  }, [selected?.id]);

  if (creating) {
    return (
      <div className="campaigns-page">
        <div className="campaigns-header">
          <div>
            <h2>Campanhas de SMS</h2>
            <p className="muted">
              Crie, importe audiência e dispare via IAGENTE.
            </p>
          </div>
          <div className="campaigns-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => setCreating(false)}
            >
              Voltar
            </button>
          </div>
        </div>

        <SmsCampaignCreateWizard
          onExit={() => {
            setCreating(false);
            stopPolling();
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
          <button
            className="btn secondary"
            type="button"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Atualizando..." : "Atualizar"}
          </button>

          <button
            className="btn primary"
            type="button"
            onClick={() => setCreating(true)}
          >
            Nova campanha
          </button>

          {onExit && (
            <button className="btn ghost" type="button" onClick={onExit}>
              Sair
            </button>
          )}
        </div>
      </div>

      <div className="campaigns-grid">
        {/* LISTA */}
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
                  <div className="muted">
                    {(c.createdAt || "")
                      .slice(0, 19)
                      .replace("T", " ")}
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => openReport(c)}
                    >
                      Ver relatório
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RELATÓRIO */}
        <div className="campaigns-card">
          <div className="sms-report-header">
            <h3>Relatório</h3>

            {csvDownloadUrl && (
              <a
                href={csvDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="sms-download-btn"
              >
                Baixar Excel
              </a>
            )}
          </div>

          {!selected ? (
            <p className="muted">
              Selecione uma campanha para ver os resultados.
            </p>
          ) : reportLoading && !report ? (
            <p className="muted">Carregando relatório...</p>
          ) : reportError ? (
            <div className="alert error">{reportError}</div>
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

              {reportLoading && (
                <p className="muted" style={{ marginTop: 10 }}>
                  Atualizando relatório...
                </p>
              )}

              <div className="campaigns-table" style={{ marginTop: 12 }}>
                <div className="campaigns-row head">
                  <div>Telefone</div>
                  <div>Status</div>
                  <div>Retorno</div>
                </div>

                {(report.results || []).slice(0, 200).map((r, idx) => {
                  const details = r.providerRaw || r.error || "-";

                  return (
                    <div
                      className="campaigns-row"
                      key={`${r.codeSms}_${idx}`}
                    >
                      <div className="truncate">{r.phone}</div>
                      <div>
                        <span className={`pill ${r.status}`}>
                          {r.status}
                        </span>
                      </div>

                      <div
                        className="muted"
                        title={details}
                        style={{
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                          lineHeight: "1.4",
                          maxWidth: 520
                        }}
                      >
                        {details}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(report.results) &&
                report.results.length > 200 && (
                  <p className="muted" style={{ marginTop: 10 }}>
                    Mostrando os primeiros 200 resultados.
                  </p>
                )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
