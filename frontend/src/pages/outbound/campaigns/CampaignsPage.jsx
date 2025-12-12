// frontend/src/pages/outbound/campaigns/CampaignsPage.jsx
import { useEffect, useState } from "react";
import "../../../styles/campaigns.css";
import { fetchCampaigns } from "../../../api";

function fmtDate(iso) {
  if (!iso) return "-";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function badge(status) {
  const s = status || "draft";
  const map = {
    draft: { label: "Rascunho", cls: "cmp-badge-draft" },
    ready: { label: "Pronta", cls: "cmp-badge-ready" },
    sending: { label: "Enviando", cls: "cmp-badge-sending" },
    done: { label: "Concluída", cls: "cmp-badge-done" },
    failed: { label: "Falhou", cls: "cmp-badge-failed" }
  };
  return map[s] || { label: s, cls: "" };
}

export default function CampaignsPage({ onNew, onOpenReport }) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const list = await fetchCampaigns();
      setItems(Array.isArray(list) ? list : []);
    } catch (e) {
      setErr(e?.message || "Erro ao carregar campanhas.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="cmp-wrap">
      <div className="cmp-header">
        <div>
          <h1>Campanhas</h1>
          <div className="cmp-subtitle">
            Lista de campanhas (criar, acompanhar e auditar envios).
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="cmp-btn" onClick={load} title="Atualizar">
            Atualizar
          </button>
          <button className="cmp-btn cmp-btn-primary" onClick={onNew}>
            + Nova campanha
          </button>
        </div>
      </div>

      {err ? (
        <div className="cmp-card" style={{ borderColor: "rgba(239,68,68,0.35)" }}>
          <div className="cmp-pill">
            <span className="cmp-err">●</span> {err}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="cmp-card">Carregando…</div>
      ) : items.length === 0 ? (
        <div className="cmp-card">Nenhuma campanha criada ainda.</div>
      ) : (
        <div className="cmp-card">
          <div style={{ overflowX: "auto" }}>
            <table className="cmp-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Template</th>
                  <th>Audiência</th>
                  <th>Criada em</th>
                  <th>Atualizada em</th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => {
                  const b = badge(c.status);
                  return (
                    <tr
                      key={c.id}
                      style={{ cursor: onOpenReport ? "pointer" : "default" }}
                      onClick={() =>
                        typeof onOpenReport === "function" &&
                        onOpenReport(c.id)
                      }
                    >
                      <td style={{ fontWeight: 700 }}>{c.name}</td>
                      <td>
                        <span className={`cmp-badge ${b.cls}`}>
                          {b.label}
                        </span>
                      </td>
                      <td>{c.templateName}</td>
                      <td>
                        {c?.audience?.validRows ?? 0}/
                        {c?.audience?.totalRows ?? 0}
                      </td>
                      <td>{fmtDate(c.createdAt)}</td>
                      <td>{fmtDate(c.updatedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 12, opacity: 0.8, fontSize: 13 }}>
            Dica: após iniciar uma campanha, clique em “Atualizar” para acompanhar o envio.
          </div>
        </div>
      )}
    </div>
  );
}
