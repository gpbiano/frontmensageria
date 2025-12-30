// frontend/src/pages/outbound/sms/SmsCampaignsPage.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { fetchSmsCampaigns, fetchSmsCampaignReport } from "../../../api";
import SmsCampaignCreateWizard from "./SmsCampaignCreateWizard.jsx";
import "../../../styles/campaigns.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_KEY);
}

function filenameSafe(s) {
  return String(s || "")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function formatDateTime(iso) {
  const s = String(iso || "");
  if (!s) return "-";
  return s.slice(0, 19).replace("T", " ");
}

function statusLabel(s) {
  const v = String(s || "").toLowerCase();
  if (v === "draft") return "Rascunho";
  if (v === "running") return "Enviando";
  if (v === "paused") return "Pausada";
  if (v === "canceled") return "Cancelada";
  if (v === "finished") return "Finalizada";
  if (v === "failed") return "Falhou";
  return v || "-";
}

function statusPillClass(s) {
  const v = String(s || "").toLowerCase();
  // reaproveita .pill do campaigns.css (se existir)
  // e adiciona classes previsíveis pra você estilizar
  return `pill ${v || "unknown"}`;
}

function canEditCampaign(c) {
  const st = String(c?.status || "").toLowerCase();
  return ["draft", "paused", "failed"].includes(st);
}

function getAudienceCount(c) {
  // compat: audienceCount (se vier pronto) ou audience.total (do router) ou 0
  if (Number.isFinite(Number(c?.audienceCount))) return Number(c.audienceCount);
  if (Number.isFinite(Number(c?.audience?.total))) return Number(c.audience.total);
  if (Array.isArray(c?.audience?.rows)) return c.audience.rows.length;
  return 0;
}

// Ícones leves (sem dependência externa)
function Icon({ name, size = 18, title }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" };
  const stroke = { stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round" };

  const paths = {
    plus: (
      <>
        <path {...stroke} d="M12 5v14" />
        <path {...stroke} d="M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path {...stroke} d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path {...stroke} d="M21 3v7h-7" />
      </>
    ),
    report: (
      <>
        <path {...stroke} d="M4 19V5" />
        <path {...stroke} d="M4 19h16" />
        <path {...stroke} d="M8 15V9" />
        <path {...stroke} d="M12 15V6" />
        <path {...stroke} d="M16 15v-4" />
      </>
    ),
    edit: (
      <>
        <path {...stroke} d="M12 20h9" />
        <path {...stroke} d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z" />
      </>
    ),
    download: (
      <>
        <path {...stroke} d="M12 3v12" />
        <path {...stroke} d="M7 10l5 5 5-5" />
        <path {...stroke} d="M5 21h14" />
      </>
    ),
    search: (
      <>
        <circle {...stroke} cx="11" cy="11" r="7" />
        <path {...stroke} d="M20 20l-3.5-3.5" />
      </>
    ),
    chevronRight: (
      <>
        <path {...stroke} d="M9 18l6-6-6-6" />
      </>
    )
  };

  return (
    <svg {...common} aria-hidden="true">
      <title>{title || name}</title>
      {paths[name] || null}
    </svg>
  );
}

export default function SmsCampaignsPage({ onExit }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [creating, setCreating] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState(null); // ✅ editar rascunho

  const [selected, setSelected] = useState(null);
  const [report, setReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");

  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");

  const [query, setQuery] = useState("");
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
    setDownloadError("");
    stopPolling();

    async function loadReport() {
      setReportLoading(true);
      setReportError("");
      try {
        const r = await fetchSmsCampaignReport(camp.id);
        setReport(r);
        if (r?.status && String(r.status).toLowerCase() !== "running") stopPolling();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return items;

    return items.filter((c) => {
      const name = String(c?.name || "").toLowerCase();
      const status = String(c?.status || "").toLowerCase();
      return name.includes(q) || status.includes(q) || String(c?.id || "").includes(q);
    });
  }, [items, query]);

  const totals = useMemo(() => {
    const total = items.length;
    const drafts = items.filter((x) => String(x?.status || "").toLowerCase() === "draft").length;
    const running = items.filter((x) => String(x?.status || "").toLowerCase() === "running").length;
    const finished = items.filter((x) => String(x?.status || "").toLowerCase() === "finished").length;
    return { total, drafts, running, finished };
  }, [items]);

  const csvUrl = useMemo(() => {
    if (!selected?.id) return null;
    return `${API_BASE}/outbound/sms-campaigns/${selected.id}/report.csv`;
  }, [selected?.id]);

  async function baixarExcel() {
    if (!csvUrl || !selected?.id) return;

    setDownloading(true);
    setDownloadError("");

    try {
      const token = getToken();
      if (!token) {
        setDownloadError("Você não está autenticado. Faça login novamente.");
        return;
      }

      const res = await fetch(csvUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        let msg = `Falha ao baixar (HTTP ${res.status}).`;
        try {
          const t = await res.text();
          if (t) msg = t;
        } catch {}
        setDownloadError(String(msg));
        return;
      }

      const blob = await res.blob();
      const name = `sms-relatorio_${filenameSafe(selected?.name)}_${selected.id}.csv`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setDownloadError(e?.message || "Erro ao baixar o arquivo.");
    } finally {
      setDownloading(false);
    }
  }

  function startCreate() {
    stopPolling();
    setSelected(null);
    setReport(null);
    setEditingCampaign(null);
    setCreating(true);
  }

  function startEdit(c) {
    stopPolling();
    setSelected(null);
    setReport(null);
    setEditingCampaign(c);
    setCreating(true);
  }

  // =========================
  // Wizard (create/edit)
  // =========================
  if (creating) {
    const mode = editingCampaign ? "edit" : "create";

    return (
      <div className="campaigns-page">
        <div className="campaigns-header">
          <div>
            <h2>Campanhas de SMS</h2>
            <p className="muted">
              {mode === "edit"
                ? "Edite o rascunho, ajuste mensagem e audiência e inicie o envio."
                : "Crie, importe audiência e dispare."}
            </p>
          </div>

          <div className="campaigns-actions">
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                setCreating(false);
                setEditingCampaign(null);
              }}
            >
              Voltar
            </button>
          </div>
        </div>

        {/* ✅ Preparado para você me mandar o Wizard:
           - mode: "create" | "edit"
           - initialCampaign: objeto da campanha (rascunho)
           - onExit: recarrega a lista
        */}
        <SmsCampaignCreateWizard
          mode={mode}
          initialCampaign={editingCampaign}
          onExit={() => {
            setCreating(false);
            setEditingCampaign(null);
            stopPolling();
            load();
          }}
        />
      </div>
    );
  }

  // =========================
  // Page
  // =========================
  return (
    <div className="campaigns-page">
      <div className="campaigns-header">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0 }}>Campanhas de SMS</h2>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span className="pill" style={{ opacity: 0.9 }}>
                Total: {totals.total}
              </span>
              <span className="pill draft" title="Rascunhos">
                Rascunho: {totals.drafts}
              </span>
              <span className="pill running" title="Em envio">
                Enviando: {totals.running}
              </span>
              <span className="pill finished" title="Finalizadas">
                Finalizadas: {totals.finished}
              </span>
            </div>
          </div>

          <p className="muted" style={{ margin: 0 }}>
            Envio de SMS integrado via IAGENTE. Crie rascunhos, suba audiência e inicie o disparo.
          </p>
        </div>

        <div className="campaigns-actions" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            className="input"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 10,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              minWidth: 280
            }}
          >
            <span className="muted" style={{ display: "inline-flex" }}>
              <Icon name="search" size={16} />
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, status ou ID…"
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                outline: "none",
                color: "inherit"
              }}
            />
          </div>

          <button className="btn secondary" type="button" onClick={load} disabled={loading}>
            <span style={{ display: "inline-flex", marginRight: 8 }}>
              <Icon name="refresh" size={18} />
            </span>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>

          <button className="btn primary" type="button" onClick={startCreate}>
            <span style={{ display: "inline-flex", marginRight: 8 }}>
              <Icon name="plus" size={18} />
            </span>
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <h3 style={{ margin: 0 }}>Campanhas</h3>
            <span className="muted" style={{ fontSize: 13 }}>
              {filtered.length} de {items.length}
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            {loading ? (
              <p className="muted">Carregando…</p>
            ) : !filtered.length ? (
              <div className="alert" style={{ marginTop: 10 }}>
                Nenhuma campanha encontrada.
              </div>
            ) : (
              <div className="campaigns-table">
                <div className="campaigns-row head">
                  <div>Nome</div>
                  <div>Status</div>
                  <div>Audiência</div>
                  <div>Criada</div>
                  <div style={{ textAlign: "right" }}>Ações</div>
                </div>

                {filtered.map((c) => {
                  const isActive = selected?.id === c.id;

                  return (
                    <div
                      className={`campaigns-row ${isActive ? "active" : ""}`}
                      key={c.id}
                      onClick={() => openReport(c)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") openReport(c);
                      }}
                      style={{
                        cursor: "pointer",
                        background: isActive ? "rgba(46, 204, 113, 0.06)" : undefined,
                        borderRadius: 10
                      }}
                      title="Clique para abrir relatório"
                    >
                      <div className="truncate" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="truncate" style={{ fontWeight: 600 }}>
                          {c.name}
                        </span>
                        <span className="muted" style={{ fontSize: 12 }}>
                          #{String(c.id).slice(0, 8)}
                        </span>
                      </div>

                      <div>
                        <span className={statusPillClass(c.status)}>{statusLabel(c.status)}</span>
                      </div>

                      <div style={{ fontVariantNumeric: "tabular-nums" }}>{getAudienceCount(c)}</div>

                      <div className="muted">{formatDateTime(c.createdAt)}</div>

                      <div style={{ textAlign: "right", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                        {canEditCampaign(c) ? (
                          <button
                            className="btn small secondary"
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              startEdit(c);
                            }}
                            title="Editar campanha (rascunho)"
                          >
                            <span style={{ display: "inline-flex", marginRight: 6 }}>
                              <Icon name="edit" size={16} />
                            </span>
                            Editar
                          </button>
                        ) : null}

                        <button
                          className="btn small"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReport(c);
                          }}
                          title="Ver relatório"
                        >
                          <span style={{ display: "inline-flex", marginRight: 6 }}>
                            <Icon name="report" size={16} />
                          </span>
                          Relatório
                        </button>

                        <span className="muted" style={{ display: "inline-flex", alignItems: "center" }}>
                          <Icon name="chevronRight" size={18} />
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RELATÓRIO */}
        <div className="campaigns-card">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h3 style={{ margin: 0 }}>Relatório</h3>
              <span className="muted" style={{ fontSize: 13 }}>
                {selected ? `Campanha: ${selected?.name}` : "Selecione uma campanha na lista"}
              </span>
            </div>

            <button
              className="btn small"
              type="button"
              onClick={baixarExcel}
              disabled={!selected || downloading}
              title={!selected ? "Selecione uma campanha para baixar." : "Baixar CSV (Excel)"}
            >
              <span style={{ display: "inline-flex", marginRight: 6 }}>
                <Icon name="download" size={16} />
              </span>
              {downloading ? "Baixando..." : "Baixar CSV"}
            </button>
          </div>

          {downloadError ? (
            <div className="alert error" style={{ marginTop: 10 }}>
              {downloadError}
            </div>
          ) : null}

          {!selected ? (
            <div className="alert" style={{ marginTop: 12 }}>
              Clique em uma campanha para ver os resultados.
            </div>
          ) : reportLoading && !report ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Carregando relatório...
            </p>
          ) : reportError ? (
            <div className="alert error" style={{ marginTop: 12 }}>
              {reportError}
            </div>
          ) : !report ? (
            <p className="muted" style={{ marginTop: 12 }}>
              Carregando relatório...
            </p>
          ) : (
            <>
              <div className="stats" style={{ marginTop: 12 }}>
                <div className="stat">
                  <div className="label">Total</div>
                  <div className="value">{report.total ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="label">Enviados</div>
                  <div className="value">{report.sent ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="label">Falhas</div>
                  <div className="value">{report.failed ?? 0}</div>
                </div>
                <div className="stat">
                  <div className="label">Status</div>
                  <div className="value">
                    <span className={statusPillClass(report.status)}>{statusLabel(report.status)}</span>
                  </div>
                </div>
              </div>

              {reportLoading && (
                <p className="muted" style={{ marginTop: 10 }}>
                  Atualizando relatório...
                </p>
              )}

              <div className="campaigns-table" style={{ marginTop: 14 }}>
                <div className="campaigns-row head">
                  <div>Telefone</div>
                  <div>Status</div>
                  <div>Retorno</div>
                </div>

                {(report.results || []).slice(0, 200).map((r, idx) => {
                  const details = r.providerRaw || r.error || "-";
                  const phone = r.phone || r.to || r.numero || "-";
                  const st = r.status || (r.ok ? "success" : "failed");

                  return (
                    <div className="campaigns-row" key={`${phone}_${idx}`}>
                      <div className="truncate" style={{ fontVariantNumeric: "tabular-nums" }}>
                        {phone}
                      </div>

                      <div>
                        <span className={statusPillClass(st)}>{String(st)}</span>
                      </div>

                      <div
                        className="muted"
                        title={String(details)}
                        style={{
                          whiteSpace: "normal",
                          wordBreak: "break-word",
                          lineHeight: "1.4",
                          maxWidth: 560
                        }}
                      >
                        {String(details)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {Array.isArray(report.results) && report.results.length > 200 && (
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
