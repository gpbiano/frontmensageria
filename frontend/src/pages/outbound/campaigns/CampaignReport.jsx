import { useEffect, useMemo, useState } from "react";
import { fetchCampaigns } from "../../../api";
import CampaignReport from "./CampaignReport.jsx";

/* =========================
   Helpers
========================= */
function toISODateInput(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatBR(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("pt-BR");
  } catch {
    return String(iso);
  }
}

function pct(v) {
  return `${Math.round(v)}%`;
}

/* =========================
   Mini Bar Chart (CSS)
========================= */
function Bar({ label, value, color = "#2ecc71" }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
        <span>{label}</span>
        <b>{pct(value)}</b>
      </div>
      <div
        style={{
          height: 8,
          borderRadius: 6,
          background: "rgba(255,255,255,.12)",
          overflow: "hidden",
          marginTop: 4
        }}
      >
        <div
          style={{
            width: `${Math.min(100, value)}%`,
            height: "100%",
            background: color,
            transition: "width .4s ease"
          }}
        />
      </div>
    </div>
  );
}

/* =========================
   Page
========================= */
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
  const [channel, setChannel] = useState("all"); // ✅ NOVO: sms | whatsapp | all

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchCampaigns();
      const list = Array.isArray(res?.items)
        ? res.items
        : Array.isArray(res)
        ? res
        : [];
      setCampaigns(list);
    } catch (e) {
      setError(e?.message || "Falha ao carregar analytics");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  /* =========================
     Filters
  ========================= */
  const filteredCampaigns = useMemo(() => {
    const fromTs = from ? new Date(from + "T00:00:00").getTime() : null;
    const toTs = to ? new Date(to + "T23:59:59").getTime() : null;

    return campaigns.filter((c) => {
      const ts = c?.createdAt ? new Date(c.createdAt).getTime() : null;

      if (fromTs && ts && ts < fromTs) return false;
      if (toTs && ts && ts > toTs) return false;

      if (campaignId !== "all" && String(c?.id) !== String(campaignId)) return false;
      if (channel !== "all" && String(c?.channel) !== channel) return false;

      return true;
    });
  }, [campaigns, from, to, campaignId, channel]);

  /* =========================
     Aggregate Metrics
  ========================= */
  const metrics = useMemo(() => {
    let total = 0;
    let success = 0;
    let failed = 0;

    filteredCampaigns.forEach((c) => {
      const s = Number(c?.stats?.sent || 0);
      const ok = Number(c?.stats?.success || 0);
      const fail = Number(c?.stats?.failed || 0);

      total += s;
      success += ok;
      failed += fail;
    });

    const successRate = total ? (success / total) * 100 : 0;
    const failRate = total ? (failed / total) * 100 : 0;

    return { total, success, failed, successRate, failRate };
  }, [filteredCampaigns]);

  return (
    <div className="page outbound-page">
      <div className="page-header">
        <h1>Analytics</h1>
        <p className="page-subtitle">
          Visão unificada de campanhas SMS e WhatsApp.
        </p>
      </div>

      {error && <div className="glp-alert glp-alert--bad">{error}</div>}
      {loading && <div className="glp-skeleton">Carregando…</div>}

      <div className="glp-surface">
        {/* =========================
            Filters
        ========================= */}
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

            <div className="glp-field">
              <div className="glp-field__label">Canal</div>
              <select className="glp-select" value={channel} onChange={(e) => setChannel(e.target.value)}>
                <option value="all">Todos</option>
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
          </div>

          <div className="glp-toolbar__right">
            <span className="glp-muted">
              Campanhas filtradas: {filteredCampaigns.length} • Gerado em{" "}
              {formatBR(new Date().toISOString())}
            </span>
          </div>
        </div>

        {/* =========================
            KPI Cards
        ========================= */}
        <div className="glp-grid glp-grid--4">
          <div className="glp-card">
            <div className="glp-card__label">Total enviados</div>
            <div className="glp-card__value">{metrics.total}</div>
          </div>

          <div className="glp-card">
            <div className="glp-card__label">Sucesso</div>
            <div className="glp-card__value">{metrics.success}</div>
          </div>

          <div className="glp-card">
            <div className="glp-card__label">Falhas</div>
            <div className="glp-card__value">{metrics.failed}</div>
          </div>

          <div className="glp-card">
            <div className="glp-card__label">Taxa sucesso</div>
            <div className="glp-card__value">{metrics.successRate.toFixed(1)}%</div>
          </div>
        </div>

        {/* =========================
            Charts
        ========================= */}
        <div className="glp-grid glp-grid--2" style={{ marginTop: 20 }}>
          <div className="glp-card">
            <h3 style={{ marginTop: 0 }}>Distribuição</h3>
            <Bar label="Sucesso" value={metrics.successRate} color="#2ecc71" />
            <Bar label="Falhas" value={metrics.failRate} color="#e74c3c" />
          </div>

          <div className="glp-card">
            <h3 style={{ marginTop: 0 }}>Canais</h3>
            <Bar
              label="SMS"
              value={
                metrics.total
                  ? (filteredCampaigns.filter((c) => c.channel === "sms").length /
                      filteredCampaigns.length) *
                    100
                  : 0
              }
              color="#3498db"
            />
            <Bar
              label="WhatsApp"
              value={
                metrics.total
                  ? (filteredCampaigns.filter((c) => c.channel === "whatsapp").length /
                      filteredCampaigns.length) *
                    100
                  : 0
              }
              color="#25D366"
            />
          </div>
        </div>

        {/* =========================
            Campaign deep report
        ========================= */}
        {campaignId !== "all" ? <CampaignReport campaignId={campaignId} /> : null}
      </div>
    </div>
  );
}
