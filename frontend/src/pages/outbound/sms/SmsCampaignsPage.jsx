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

function canEditCampaign(c) {
  const st = String(c?.status || "").toLowerCase();
  return ["draft", "paused", "failed"].includes(st);
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

    // {{1}} -> var_1
    if (/^\d+$/.test(raw)) {
      out.add(`var_${raw}`);
      continue;
    }

    // {{var_1}} -> var_1
    if (/^var_\d+$/i.test(raw)) {
      out.add(raw.toLowerCase());
      continue;
    }

    // {{nome}} -> nome
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
    chevronDown: (
      <>
        <path {...stroke} d="M6 9l6 6 6-6" />
      </>
    ),
    search: (
      <>
        <circle {...stroke} cx="11" cy="11" r="7" />
        <path {...stroke} d="M20 20l-3.5-3.5" />
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

  // ✅ dropdown ações por linha (resolve sobreposição)
  const [actionsOpenId, setActionsOpenId] = useState(null);
  const actionsWrapRef = useRef(null);

  async function load() {
    setLoading(true);
    try {
      const r = await fetchSmsCampaigns();
      setItems(r.items || []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  // fecha dropdown ao clicar fora
  useEffect(() => {
    function onDown(e) {
      if (!actionsWrapRef.current) return;
      if (actionsWrapRef.current.contains(e.target)) return;
      setActionsOpenId(null);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
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
    setActionsOpenId(null);
    setEditingCampaign(null);
    setCreating(true);
  }

  function startEdit(c) {
    setActionsOpenId(null);
    setEditingCampaign(c);
    setCreating(true);
  }

  async function handleDeleteFromList(c) {
    if (!c?.id) return;
    if (!canDeleteCampaign(c)) {
      alert("Só é possível excluir campanhas em rascunho.");
      return;
    }

    const ok = window.confirm(`Excluir a campanha "${c?.name || "Campanha"}"?\nEssa ação não pode ser desfeita.`);
    if (!ok) return;

    try {
      await deleteSmsCampaign(c.id);
      await load();
    } catch (e) {
      alert(e?.message || "Erro ao excluir campanha.");
    }
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
  // Page (envios apenas) — SEM "Relatórios" aqui
  // =========================
  return (
    <div className="campaigns-page" ref={actionsWrapRef}>
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
            Esta página é apenas para envios. Relatórios/analytics ficam em <b>Reportes</b>.
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

      {/* ✅ força 1 coluna (remove o “card” da direita e evita sobra de espaço) */}
      <div className="campaigns-grid" style={{ gridTemplateColumns: "1fr" }}>
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
                  const open = actionsOpenId === c.id;

                  return (
                    <div className="campaigns-row" key={c.id} style={{ borderRadius: 10 }}>
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

                      {/* ✅ AÇÕES: dropdown (sem sobreposição quebrada) */}
                      <div style={{ textAlign: "right", position: "relative" }}>
                        <button
                          className="btn small secondary"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionsOpenId((prev) => (prev === c.id ? null : c.id));
                          }}
                          style={{ whiteSpace: "nowrap" }}
                          title="Abrir ações"
                        >
                          Ações{" "}
                          <span style={{ display: "inline-flex", marginLeft: 6, opacity: 0.9 }}>
                            <Icon name="chevronDown" size={16} />
                          </span>
                        </button>

                        {open ? (
                          <div
                            className="glp-surface"
                            style={{
                              position: "absolute",
                              right: 0,
                              top: "calc(100% + 8px)",
                              minWidth: 220,
                              padding: 10,
                              borderRadius: 12,
                              zIndex: 40,
                              boxShadow: "0 10px 30px rgba(0,0,0,0.25)"
                            }}
                          >
                            <button
                              className="btn small secondary"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionsOpenId(null);
                                startEdit(c);
                              }}
                              style={{ width: "100%", justifyContent: "flex-start", marginBottom: 8 }}
                              title={canEditCampaign(c) ? "Abrir / Editar" : "Abrir (somente leitura)"}
                            >
                              <span style={{ display: "inline-flex", marginRight: 8 }}>
                                <Icon name="edit" size={16} />
                              </span>
                              {canEditCampaign(c) ? "Abrir / Editar" : "Abrir (somente leitura)"}
                            </button>

                            <button
                              className="btn small secondary"
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setActionsOpenId(null);
                                downloadTemplateFromCampaign(c);
                              }}
                              style={{ width: "100%", justifyContent: "flex-start", marginBottom: 8 }}
                              title="Baixar planilha exemplo (CSV) baseada na mensagem"
                            >
                              <span style={{ display: "inline-flex", marginRight: 8 }}>
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
                                  setActionsOpenId(null);
                                  handleDeleteFromList(c);
                                }}
                                style={{ width: "100%", justifyContent: "flex-start" }}
                                title="Excluir campanha (rascunho)"
                              >
                                <span style={{ display: "inline-flex", marginRight: 8 }}>
                                  <Icon name="trash" size={16} />
                                </span>
                                Excluir
                              </button>
                            ) : (
                              <div style={{ fontSize: 12, opacity: 0.75 }}>Excluir disponível só em rascunho.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ✅ aviso simples (sem card de relatório) */}
          <div className="alert" style={{ marginTop: 14 }}>
            ✅ Esta tela é apenas para criação e disparo de SMS. Relatórios/analytics ficam em{" "}
            <b>Reportes → Analytics</b>.
          </div>
        </div>
      </div>
    </div>
  );
}
