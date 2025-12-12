// src/outbound/CampaignReport.jsx
import { useEffect, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function CampaignReport({ campaignId, onBack }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/campaigns/${campaignId}/report`);
      if (!res.ok) {
        throw new Error("Erro ao buscar relatório");
      }
      const data = await res.json();
      setReport(data);
    } catch (err) {
      console.error(err);
      alert("Erro ao carregar relatório.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [campaignId]);

  if (loading) return <p>Carregando relatório...</p>;
  if (!report) return <p>Nenhum relatório disponível.</p>;

  function rate(part, total) {
    if (!total || total === 0) return "0%";
    return ((part / total) * 100).toFixed(1) + "%";
  }

  return (
    <div className="outbound-section">
      <button onClick={onBack} style={{ marginBottom: "16px" }}>
        ← Voltar
      </button>

      <h2>Relatório da Campanha #{report.campaignId}</h2>

      <div className="report-grid">
        <div className="report-card">
          <strong>Enviadas:</strong> {report.sent}
        </div>
        <div className="report-card">
          <strong>Entregues:</strong> {report.delivered}
          <br />
          <small>{rate(report.delivered, report.sent)} de entrega</small>
        </div>
        <div className="report-card">
          <strong>Lidas:</strong> {report.read}
          <br />
          <small>{rate(report.read, report.sent)} taxa de leitura</small>
        </div>
        <div className="report-card">
          <strong>Falhas:</strong> {report.failed}
          <br />
          <small>{rate(report.failed, report.sent)} falhas</small>
        </div>
      </div>

      {report.timeline && (
        <>
          <h3>Linha do tempo</h3>
          <p>
            <strong>Início:</strong>{" "}
            {report.timeline.startedAt
              ? new Date(report.timeline.startedAt).toLocaleString()
              : "-"}
            <br />
            <strong>Fim:</strong>{" "}
            {report.timeline.finishedAt
              ? new Date(report.timeline.finishedAt).toLocaleString()
              : "-"}
          </p>
        </>
      )}

      <h3>Destinatários</h3>

      {report.results && report.results.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th>Telefone</th>
              <th>Status</th>
              <th>Última atualização</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r, i) => (
              <tr key={i}>
                <td>{r.phone}</td>
                <td>{r.status}</td>
                <td>
                  {r.updatedAt
                    ? new Date(r.updatedAt).toLocaleString()
                    : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Nenhum destinatário registrado ainda.</p>
      )}
    </div>
  );
}