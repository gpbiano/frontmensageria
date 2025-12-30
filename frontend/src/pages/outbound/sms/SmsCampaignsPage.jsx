// frontend/src/pages/outbound/sms/SmsCampaignsPage.jsx
import { useEffect, useRef, useState, useMemo } from "react";
import { fetchSmsCampaigns, deleteSmsCampaign } from "../../../api";
import SmsCampaignCreateWizard from "./SmsCampaignCreateWizard.jsx";
import "../../../styles/campaigns.css";

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
  return `pill ${v || "unknown"}`;
}

function canDeleteCampaign(c) {
  return String(c?.status || "").toLowerCase() === "draft";
}

function getAudienceCount(c) {
  if (Number.isFinite(Number(c?.audienceCount))) return Number(c.audienceCount);
  if (Number.isFinite(Number(c?.audience?.total))) return Number(c.audience.total);
  if (Array.isArray(c?.audience?.rows)) return c.audience.rows.length;
  return 0;
}

// -------------------------
// CSV template helpers
// -------------------------
function extractTemplateVars(message) {
  const text = String(message || "");
  const re = /{{\s*([^}]+?)\s*}}/g;

  const out = new Set();
  let m;

  while ((m = re.exec(text)) !== null) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) {
      out.add(`var_${raw}`);
      continue;
    }

    if (/^var_\d+$/i.test(raw)) {
      out.add(raw.toLowerCase());
      continue;
    }

    out.add(raw);
  }

  const arr = Array.from(out);

  const varOnes = arr
    .filter((k) => /^var_\d+$/i.test(k))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));

  const others = arr
    .filter((k) => !/^var_\d+$/i.test(k))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [...varOnes, ...others];
}

function buildCsvTemplate({ message, delimiter = ";" }) {
  const vars = extractTemplateVars(message);
  const headers = ["numero", ...vars];

  const row1 = ["5511999999999"];
  const row2 = ["5511988887777"];

  for (const v of vars) {
    if (/^var_\d+$/i.test(v)) {
      const n = v.split("_")[1];
      row1.push(`Exemplo_${n}_A`);
      row2.push(`Exemplo_${n}_B`);
    } else {
      row1.push(`Exemplo_${v}_A`);
      row2.push(`Exemplo_${v}_B`);
    }
  }

  const lines = [headers.join(delimiter), row1.join(delimiter), row2.join(delimiter)];
  return { csvText: lines.join("\n"), headers, vars };
}

function downloadTextFile({ content, filename, mime = "text/csv;charset=utf-8" }) {
  const blob = new Blob([content], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

// Ícones leves (sem dependência externa)
function Icon({ name, size = 18, title }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none" };
  const stroke = {
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  };

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
    edit: (
      <>
        <path {...stroke} d="M12 20h9" />
        <path
          {...stroke}
          d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5z"
        />
      </>
    ),
    template: (
      <>
        <path {...stroke} d="M4 4h16v16H4z" />
        <path {...stroke} d="M7 8h10" />
        <path {...stroke} d="M7 12h10" />
        <path {...stroke} d="M7 16h6" />
      </>
    ),
    trash: (
      <>
        <path {...stroke} d="M3 6h18" />
        <path {...stroke} d="M8 6V4h8v2" />
        <path {...stroke} d="M6 6l1 16h10l1-16" />
        <path {...stroke} d="M10 11v6" />
        <path {...stroke} d="M14 11v6" />
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
  const [editingCampaign, setEditingCampaign] = useState(null);

  const [query, setQuery] = useState("");

  async function load() {
    setLoading(true);
    try {
      const r = await fetchSmsCampaigns();
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteFromList(c) {
    if (!c?.id) return;

    if (!canDeleteCampaign(c)) {
      alert("Só é possível excluir campanhas em rascunho.");
      return;
    }

    const ok = window.confirm(
      `Excluir a campanha "${c?.name || "Campanha"}"?\nEssa ação não pode ser desfeita.`
    );
    if (!ok) return;

    try {
      await deleteSmsCampaign(c.id);
      await load();
    } catch (e) {
      alert(e?.message || "Erro ao excluir campanha.");
    }
  }

  useEffect(() => {
    load();
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

  function downloadTemplateFromCampaign(c) {
    const msg = String(c?.metadata?.message || c?.message || "").trim() || "Olá {{1}}!";
    const { csvText } = buildCsvTemplate({ message: msg, delimiter: ";" });

    const fname = `modelo_audiencia_sms_${filenameSafe(c?.name || "campanha")}_${String(c?.id || "").slice(
      0,
      8
    )}.csv`;

    downloadTextFile({ content: csvText, filename: fname });
  }

  function startCreate() {
    setEditingCampaign(null);
    setCreating(true);
  }

  function startEdit(c) {
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
                ? "Edite mensagem, audiência e controle o envio por lotes."
                : "Crie, importe audiência e dispare por lotes."}
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

        <SmsCampaignCreateWizard
          mode={mode}
          initialCampaign={editingCampaign}
          onExit={() => {
            setCreating(false);
            setEditingCampaign(null);
            load();
          }}
        />
      </div>
    );
  }

  // =========================
  // Page (sem Report / Analytics)
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
            Esta página é apenas para <b>envios</b>. Relatórios/analytics ficam em <b>Reports</b>.
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

              {filtered.map((c) => (
                <div
                  className="campaigns-row"
                  key={c.id}
                  onClick={() => startEdit(c)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") startEdit(c);
                  }}
                  style={{ cursor: "pointer", borderRadius: 10 }}
                  title="Clique para abrir e gerenciar o envio"
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
                    <button
                      className="btn small secondary"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(c);
                      }}
                      title="Abrir para editar / enviar"
                    >
                      <span style={{ display: "inline-flex", marginRight: 6 }}>
                        <Icon name="edit" size={16} />
                      </span>
                      Abrir
                    </button>

                    <button
                      className="btn small secondary"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        downloadTemplateFromCampaign(c);
                      }}
                      title="Baixar planilha exemplo (CSV) baseada na mensagem"
                    >
                      <span style={{ display: "inline-flex", marginRight: 6 }}>
                        <Icon name="template" size={16} />
                      </span>
                      Modelo CSV
                    </button>

                    {canDeleteCampaign(c) ? (
                      <button
                        className="btn small secondary"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFromList(c);
                        }}
                        title="Excluir campanha (rascunho)"
                      >
                        <span style={{ display: "inline-flex", marginRight: 6 }}>
                          <Icon name="trash" size={16} />
                        </span>
                        Excluir
                      </button>
                    ) : null}

                    <span className="muted" style={{ display: "inline-flex", alignItems: "center" }}>
                      <Icon name="chevronRight" size={18} />
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
