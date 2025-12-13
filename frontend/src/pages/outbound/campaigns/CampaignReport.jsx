import { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function formatBR(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return String(iso);
  }
}

function toPct(n) {
  if (!Number.isFinite(n)) return "0.0%";
  return `${n.toFixed(1)}%`;
}

function buildAbsoluteUrl(maybeRelative) {
  if (!maybeRelative) return null;
  // já é absoluto
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  // relativo do backend
  const base = String(API_BASE || "").replace(/\/$/, "");
  const rel = String(maybeRelative).startsWith("/") ? maybeRelative : `/${maybeRelative}`;
  return `${base}${rel}`;
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fallback antigo
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }
}

export default function CampaignReport({ campaignId }) {
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState(null);

  const isAll = campaignId === "all" || !campaignId;

  async function load() {
    if (isAll) {
      setReport(null);
      setError("");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(
        `${API_BASE}/outbound/campaigns/${encodeURIComponent(String(campaignId))}/report`
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Falha ao carregar report (${res.status})`);
      }

      const data = await res.json();
      setReport(data);
    } catch (e) {
      setError(e?.message || "Falha ao carregar report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  // ✅ ENDPOINTS NOVOS (padronizados no campaignsRouter)
  const exportCsvUrl = useMemo(() => {
    if (isAll) return null;
    return `${API_BASE}/outbound/campaigns/${encodeURIComponent(String(campaignId))}/export.csv`;
  }, [campaignId, isAll]);

  const exportPdfUrl = useMemo(() => {
    if (isAll) return null;
    return `${API_BASE}/outbound/campaigns/${encodeURIComponent(String(campaignId))}/export.pdf`;
  }, [campaignId, isAll]);

  const metrics = useMemo(() => {
    // o backend já manda sent/delivered/read/failed
    const sent = Number(report?.sent || 0);
    const delivered = Number(report?.delivered || 0);
    const read = Number(report?.read || 0);
    const failed = Number(report?.failed || 0);

    const base =
      Number.isFinite(report?.base) ? Number(report.base) :
      (Array.isArray(report?.results) ? report.results.length : 0);

    const deliveryRate = base ? (delivered / base) * 100 : 0;
    const readRate = base ? (read / base) * 100 : 0;
    const failRate = base ? (failed / base) * 100 : 0;

    return { base, sent, delivered, read, failed, deliveryRate, readRate, failRate };
  }, [report]);

  async function handleCopy(link) {
    if (!link) return;
    setCopying(true);
    const ok = await copyToClipboard(link);
    setCopying(false);
    if (!ok) setError("Não consegui copiar o link. Tente manualmente.");
  }

  if (isAll) {
    return (
      <div className="glp-surface" style={{ marginTop: 16 }}>
        <div className="glp-alert glp-alert--info">
          Selecione uma campanha no filtro <b>“Campanha”</b> para ver o relatório e liberar a exportação
          (CSV/PDF).
        </div>
      </div>
    );
  }

  return (
    <div className="glp-surface" style={{ marginTop: 16 }}>
      <div className="glp-toolbar" style={{ alignItems: "center" }}>
        <div className="glp-toolbar__left" style={{ flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Relatório da campanha</div>
            <div className="glp-muted" style={{ fontSize: 12 }}>
              {report?.name ? (
                <>
                  <b>{report.name}</b> • #{report.campaignId || campaignId}
                </>
              ) : (
                <>#{campaignId}</>
              )}
              {"  "}
              {report?.timeline?.startedAt ? `• Início: ${formatBR(report.timeline.startedAt)}` : ""}
              {report?.timeline?.finishedAt ? `• Fim: ${formatBR(report.timeline.finishedAt)}` : ""}
            </div>
          </div>
        </div>

        <div className="glp-toolbar__right" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Atualizando..." : "Atualizar report"}
          </button>

          <a
            className="btn btn-secondary"
            href={exportCsvUrl || "#"}
            target="_blank"
            rel="noreferrer"
            style={{
              pointerEvents: exportCsvUrl ? "auto" : "none",
              opacity: exportCsvUrl ? 1 : 0.6
            }}
            title="Baixar relatório completo em CSV"
          >
            Exportar CSV
          </a>

          <a
            className="btn btn-primary"
            href={exportPdfUrl || "#"}
            target="_blank"
            rel="noreferrer"
            style={{
              pointerEvents: exportPdfUrl ? "auto" : "none",
              opacity: exportPdfUrl ? 1 : 0.6
            }}
            title="Baixar relatório em PDF"
          >
            Exportar PDF
          </a>
        </div>
      </div>

      {error && <div className="glp-alert glp-alert--bad">{error}</div>}
      {loading && <div className="glp-skeleton">Carregando relatório…</div>}

      {report && !loading && (
        <>
          <div className="glp-grid glp-grid--4" style={{ marginTop: 14 }}>
            <div className="glp-card">
              <div className="glp-card__label">Base</div>
              <div className="glp-card__value">{metrics.base}</div>
            </div>
            <div className="glp-card">
              <div className="glp-card__label">Entrega</div>
              <div className="glp-card__value">{toPct(metrics.deliveryRate)}</div>
            </div>
            <div className="glp-card">
              <div className="glp-card__label">Leitura</div>
              <div className="glp-card__value">{toPct(metrics.readRate)}</div>
            </div>
            <div className="glp-card">
              <div className="glp-card__label">Falhas</div>
              <div className="glp-card__value">{toPct(metrics.failRate)}</div>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Destinatários</div>

            <div className="glp-table-wrap">
              <table className="glp-table">
                <thead>
                  <tr>
                    <th>Telefone</th>
                    <th>Status</th>
                    <th>Atualizado</th>
                    <th>Erro</th>
                    <th style={{ width: 170 }}>Ações</th>
                  </tr>
                </thead>

                <tbody>
                  {(report.results || []).map((r, idx) => {
                    const status = safeLower(r?.status || "unknown");

                    const errorCode =
                      r?.errorCode ||
                      r?.metaErrorCode ||
                      r?.error?.code ||
                      r?.metaError?.code ||
                      null;

                    const errorMessage =
                      r?.errorMessage ||
                      r?.metaErrorMessage ||
                      r?.error?.message ||
                      r?.metaError?.message ||
                      (typeof r?.error === "string" ? r.error : "") ||
                      "";

                    // o backend pode mandar metaErrorLink como "/r/meta-error/xxxx"
                    const relativeLink =
                      r?.metaErrorLink ||
                      r?.errorLink ||
                      (errorCode ? `/r/meta-error/${encodeURIComponent(errorCode)}` : null);

                    const metaErrorLink = buildAbsoluteUrl(relativeLink);

                    return (
                      <tr key={`${r.phone || "row"}-${idx}`}>
                        <td>{r.phone || "-"}</td>

                        <td>
                          <span className={`glp-pill glp-pill--${status}`}>
                            {status}
                          </span>
                        </td>

                        <td>{formatBR(r.updatedAt)}</td>

                        <td style={{ color: errorCode ? "#fca5a5" : "inherit" }}>
                          {errorCode
                            ? `#${errorCode}${errorMessage ? ` • ${errorMessage}` : ""}`
                            : "-"}
                        </td>

                        <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {metaErrorLink ? (
                            <>
                              <a
                                className="btn btn-secondary"
                                href={metaErrorLink}
                                target="_blank"
                                rel="noreferrer"
                                title="Abrir documentação do erro da Meta"
                                style={{ padding: "6px 10px" }}
                              >
                                Abrir
                              </a>

                              <button
                                className="btn btn-secondary"
                                onClick={() => handleCopy(metaErrorLink)}
                                disabled={copying}
                                title="Copiar link do erro"
                                style={{ padding: "6px 10px" }}
                              >
                                {copying ? "Copiando..." : "Copiar link"}
                              </button>
                            </>
                          ) : (
                            "-"
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {(!report.results || report.results.length === 0) && (
                    <tr>
                      <td colSpan={5} className="glp-muted">
                        Nenhum destinatário no relatório ainda.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
