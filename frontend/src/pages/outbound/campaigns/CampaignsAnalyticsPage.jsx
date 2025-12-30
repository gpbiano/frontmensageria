// frontend/src/pages/outbound/analytics/CampaignsAnalyticsPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCampaigns } from "../../../api";
import CampaignReport from "./CampaignReport.jsx";

function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function safeLower(v) {
  return String(v || "").toLowerCase();
}

function normalizeErrorCode(row) {
  return row?.errorCode ?? row?.metaErrorCode ?? row?.error?.code ?? row?.metaError?.code ?? null;
}

function formatBR(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return String(iso);
  }
}

// =========================
// UI helpers (dropdown simples)
// =========================
function useOutsideClick(ref, handler) {
  useEffect(() => {
    function onDown(e) {
      if (!ref.current) return;
      if (ref.current.contains(e.target)) return;
      handler();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ref, handler]);
}

function IconChevronDown({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
    </svg>
  );
}

function IconDownload({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M10 2a1 1 0 0 1 1 1v7.6l2.3-2.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L9 10.6V3a1 1 0 0 1 1-1z" />
      <path d="M4 13a1 1 0 0 1 1 1v2h10v-2a1 1 0 1 1 2 0v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function IconFile({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path d="M6 2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7.4a2 2 0 0 0-.6-1.4l-2.4-2.4A2 2 0 0 0 11.6 3H6zm6 1.4L15.6 7H12a2 2 0 0 1-2-2V3.4z" />
    </svg>
  );
}

// =========================
// Mini chart (sem libs)
// =========================
function MiniBar({ label, valuePct = 0, hint, color = "rgba(46, 204, 113, 0.95)" }) {
  const v = Number.isFinite(Number(valuePct)) ? Number(valuePct) : 0;
  const width = Math.max(0, Math.min(100, v));

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13 }}>
        <span style={{ opacity: 0.9 }}>{label}</span>
        <b title={hint || ""} style={{ fontVariantNumeric: "tabular-nums" }}>
          {width.toFixed(1)}%
        </b>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: "rgba(255,255,255,.10)",
          overflow: "hidden",
          marginTop: 5
        }}
      >
        <div
          style={{
            width: `${width}%`,
            height: "100%",
            background: color,
            transition: "width .35s ease"
          }}
        />
      </div>
    </div>
  );
}

export default function CampaignsAnalyticsPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [campaigns, setCampaigns] = useState([]);

  // filtros
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return toISODateInput(d);
  });
  const [to, setTo] = useState(() => toISODateInput(new Date()));
  const [campaignId, setCampaignId] = useState("all");
  const [templateName, setTemplateName] = useState("all");

  // ✅ NOVO: filtro por tipo/canal (SMS/WhatsApp)
  // Observação: vamos aceitar tanto c.channel quanto c.type (robusto)
  const [campaignType, setCampaignType] = useState("all"); // all | sms | whatsapp

  // export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(""); // "csv" | "pdf" | "pdf_campaign" | ""
  const exportRef = useRef(null);
  useOutsideClick(exportRef, () => setExportOpen(false));

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchCampaigns();
      const list = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res)
        ? res
        : [];
      setCampaigns(list);
    } catch (e) {
      setError(e?.message || "Falha ao carregar campanhas");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const templates = useMemo(() => {
    const set = new Set();
    campaigns.forEach((c) => {
      if (c?.templateName) set.add(c.templateName);
    });
    return Array.from(set).sort();
  }, [campaigns]);

  const filteredCampaigns = useMemo(() => {
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : null;

    return campaigns.filter((c) => {
      const ts = c?.createdAt ? new Date(c.createdAt).getTime() : null;

      if (fromTs && ts && ts < fromTs) return false;
      if (toTs && ts && ts > toTs) return false;

      if (campaignId !== "all" && String(c?.id) !== String(campaignId)) return false;
      if (templateName !== "all" && c?.templateName !== templateName) return false;

      // ✅ filtro por tipo (sms/whatsapp)
      if (campaignType !== "all") {
        const ch = safeLower(c?.channel || c?.type || "");
        if (ch !== campaignType) return false;
      }

      return true;
    });
  }, [campaigns, from, to, campaignId, templateName, campaignType]);

  const aggregate = useMemo(() => {
    const allRows = [];
    filteredCampaigns.forEach((c) => {
      const results = Array.isArray(c?.results) ? c.results : [];
      results.forEach((r) => {
        allRows.push({
          status: safeLower(r?.status || "sent"),
          errorCode: normalizeErrorCode(r)
        });
      });
    });

    const total = allRows.length;

    // WhatsApp tende a ter delivered/read/failed; SMS pode vir como success/failed/sent etc.
    const delivered = allRows.filter((r) => ["delivered", "success", "sent"].includes(r.status)).length;
    const read = allRows.filter((r) => r.status === "read").length;
    const failed = allRows.filter((r) => ["failed", "error"].includes(r.status)).length;

    const deliveryRate = total ? (delivered / total) * 100 : 0;
    const readRate = total ? (read / total) * 100 : 0;
    const failRate = total ? (failed / total) * 100 : 0;

    return { total, deliveryRate, readRate, failRate };
  }, [filteredCampaigns]);

  // =========================
  // EXPORT URLs (backend)
  // =========================
  const API_BASE =
    import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || "http://localhost:3010";

  const analyticsCsvUrl = useMemo(() => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (campaignId) qs.set("campaignId", campaignId);
    if (templateName) qs.set("template", templateName);
    if (campaignType !== "all") qs.set("type", campaignType); // ✅ NOVO
    return `${API_BASE}/outbound/campaigns/analytics/export.csv?${qs.toString()}`;
  }, [API_BASE, from, to, campaignId, templateName, campaignType]);

  const analyticsPdfUrl = useMemo(() => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (campaignId) qs.set("campaignId", campaignId);
    if (templateName) qs.set("template", templateName);
    if (campaignType !== "all") qs.set("type", campaignType); // ✅ NOVO
    return `${API_BASE}/outbound/campaigns/analytics/export.pdf?${qs.toString()}`;
  }, [API_BASE, from, to, campaignId, templateName, campaignType]);

  const canExportCampaignPDF = campaignId !== "all" && String(campaignId).trim() !== "";
  const campaignPdfUrl = canExportCampaignPDF
    ? `${API_BASE}/outbound/campaigns/${encodeURIComponent(String(campaignId))}/export.pdf`
    : null;

  function openExport(kind, url) {
    if (!url) return;
    setExportBusy(kind);
    try {
      window.open(url, "_blank", "noreferrer");
    } finally {
      setTimeout(() => setExportBusy(""), 450);
      setExportOpen(false);
    }
  }

  const exportLabel = useMemo(() => {
    const parts = [];
    if (campaignId !== "all") parts.push(`Campanha #${campaignId}`);
    if (templateName !== "all") parts.push(`Template ${templateName}`);
    if (campaignType !== "all") parts.push(`Tipo ${campaignType.toUpperCase()}`);
    parts.push(`Período ${from} → ${to}`);
    return parts.join(" • ");
  }, [campaignId, templateName, campaignType, from, to]);

  // ✅ Gráfico por canal (quantidade de campanhas no filtro)
  const channelSplit = useMemo(() => {
    const total = filteredCampaigns.length || 0;
    if (!total) return { sms: 0, whatsapp: 0 };
    const sms = filteredCampaigns.filter((c) => safeLower(c?.channel || c?.type) === "sms").length;
    const whatsapp = filteredCampaigns.filter((c) => safeLower(c?.channel || c?.type) === "whatsapp").length;
    return {
      sms: (sms / total) * 100,
      whatsapp: (whatsapp / total) * 100
    };
  }, [filteredCampaigns]);

  return (
    <div className="page outbound-page">
      <div className="page-header">
        <h1>Analytics</h1>
        <p className="page-subtitle">Visão unificada (SMS + WhatsApp) com filtros, performance e falhas.</p>

        <div className="page-actions" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>

          {/* ✅ Dropdown Export (CSV/PDF filtrado + PDF campanha) */}
          <div ref={exportRef} style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="btn btn-primary"
              onClick={() => setExportOpen((v) => !v)}
              disabled={loading || !!exportBusy}
              title={exportLabel}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <IconDownload />
              {exportBusy ? "Exportando..." : "Exportar"}
              <span style={{ opacity: 0.9 }}>
                <IconChevronDown />
              </span>
            </button>

            {exportOpen ? (
              <div
                className="glp-surface"
                style={{
                  position: "absolute",
                  top: "calc(100% + 8px)",
                  right: 0,
                  width: 320,
                  padding: 10,
                  borderRadius: 12,
                  boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
                  zIndex: 50
                }}
              >
                <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>{exportLabel}</div>

                <button
                  className="btn btn-secondary"
                  onClick={() => openExport("csv", analyticsCsvUrl)}
                  disabled={!!exportBusy}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 8
                  }}
                  title="Exporta CSV filtrado (gerado no backend)"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconFile /> CSV (filtrado)
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{exportBusy === "csv" ? "..." : "Baixar"}</span>
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => openExport("pdf", analyticsPdfUrl)}
                  disabled={!!exportBusy}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginBottom: 8
                  }}
                  title="Exporta PDF filtrado (gerado no backend)"
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconFile /> PDF (filtrado)
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>{exportBusy === "pdf" ? "..." : "Baixar"}</span>
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={() => openExport("pdf_campaign", campaignPdfUrl)}
                  disabled={!canExportCampaignPDF || !!exportBusy}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    opacity: canExportCampaignPDF ? 1 : 0.55
                  }}
                  title={
                    canExportCampaignPDF
                      ? "Exporta PDF da campanha selecionada"
                      : "Selecione 1 campanha (no filtro) para exportar PDF da campanha"
                  }
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <IconFile /> PDF (campanha)
                  </span>
                  <span style={{ fontSize: 12, opacity: 0.75 }}>
                    {exportBusy === "pdf_campaign" ? "..." : "Baixar"}
                  </span>
                </button>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.75 }}>
                  Dica: CSV é melhor pra auditoria; PDF é melhor pra enviar pro cliente.
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {error && <div className="glp-alert glp-alert--bad">{error}</div>}
      {loading && <div className="glp-skeleton">Carregando…</div>}

      <div className="glp-surface">
        <div className="glp-toolbar">
          <div className="glp-toolbar__left" style={{ flexWrap: "wrap" }}>
            <div className="glp-field">
              <div className="glp-field__label">De</div>
              <input className="glp-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>

            <div className="glp-field">
              <div className="glp-field__label">Até</div>
              <input className="glp-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            {/* ✅ NOVO: Tipo */}
            <div className="glp-field">
              <div className="glp-field__label">Tipo</div>
              <select className="glp-select" value={campaignType} onChange={(e) => setCampaignType(e.target.value)}>
                <option value="all">Todas</option>
                <option value="sms">SMS</option>
                <option value="whatsapp">WhatsApp</option>
              </select>
            </div>

            <div className="glp-field">
              <div className="glp-field__label">Campanha</div>
              <select className="glp-select" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
                <option value="all">Todas</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="glp-field">
              <div className="glp-field__label">Template</div>
              <select className="glp-select" value={templateName} onChange={(e) => setTemplateName(e.target.value)}>
                <option value="all">Todos</option>
                {templates.map((t, index) => (
                  <option key={`${t}-${index}`} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="glp-toolbar__right">
            <span className="glp-muted">
              Campanhas filtradas: {filteredCampaigns.length} • Gerado em {formatBR(new Date().toISOString())}
            </span>
          </div>
        </div>

        <div className="glp-grid glp-grid--4">
          <div className="glp-card">
            <div className="glp-card__label">Total</div>
            <div className="glp-card__value">{aggregate.total}</div>
          </div>
          <div className="glp-card">
            <div className="glp-card__label">Entrega</div>
            <div className="glp-card__value">{aggregate.deliveryRate.toFixed(1)}%</div>
          </div>
          <div className="glp-card">
            <div className="glp-card__label">Leitura</div>
            <div className="glp-card__value">{aggregate.readRate.toFixed(1)}%</div>
          </div>
          <div className="glp-card">
            <div className="glp-card__label">Falhas</div>
            <div className="glp-card__value">{aggregate.failRate.toFixed(1)}%</div>
          </div>
        </div>

        {/* ✅ Gráficos (ref Aivo) */}
        <div className="glp-grid glp-grid--2" style={{ marginTop: 16 }}>
          <div className="glp-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>Performance</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                base: {aggregate.total} envios
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <MiniBar label="Entrega (proxy)" valuePct={aggregate.deliveryRate} color="rgba(46, 204, 113, .95)" />
              <MiniBar label="Leitura" valuePct={aggregate.readRate} color="rgba(52, 152, 219, .95)" />
              <MiniBar label="Falhas" valuePct={aggregate.failRate} color="rgba(231, 76, 60, .95)" />
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
              * SMS pode não ter “read”; quando não existir, fica 0%.
            </div>
          </div>

          <div className="glp-card">
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <h3 style={{ margin: 0 }}>Mix por canal</h3>
              <span className="muted" style={{ fontSize: 12 }}>
                base: {filteredCampaigns.length} campanhas
              </span>
            </div>

            <div style={{ marginTop: 12 }}>
              <MiniBar label="SMS" valuePct={channelSplit.sms} color="rgba(155, 89, 182, .95)" />
              <MiniBar label="WhatsApp" valuePct={channelSplit.whatsapp} color="rgba(37, 211, 102, .95)" />
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12, opacity: 0.8 }}>
              * Percentual por quantidade de campanhas no filtro (não por envios).
            </div>
          </div>
        </div>

        {/* Report 2.0 só quando seleciona uma campanha */}
        {campaignId !== "all" ? <CampaignReport campaignId={campaignId} /> : null}
      </div>
    </div>
  );
}
