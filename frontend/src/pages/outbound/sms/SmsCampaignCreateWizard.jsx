// frontend/src/pages/outbound/sms/SmsCampaignCreateWizard.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createSmsCampaign,
  updateSmsCampaign,
  deleteSmsCampaign,
  uploadSmsCampaignAudience,
  startSmsCampaign,
  pauseSmsCampaign,
  resumeSmsCampaign,
  cancelSmsCampaign,

  // ✅ templates via api.ts (com headers certos)
  fetchSmsTemplates,
  createSmsTemplate
} from "../../../api";
import "../../../styles/campaigns.css";

const STEPS = [
  { key: "create", label: "1. Dados" },
  { key: "audience", label: "2. Audiência" },
  { key: "start", label: "3. Envio" }
];

// =========================
// Helpers: Template CSV
// =========================
function filenameSafe(s) {
  return String(s || "")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

/**
 * Extrai variáveis do template:
 * - {{1}} => var_1
 * - {{2}} => var_2
 * - {{var_1}} => var_1
 * - {{nome}} => nome
 * - ignora placeholders vazios
 */
function extractTemplateVars(message) {
  const text = String(message || "");
  const re = /{{\s*([^}]+?)\s*}}/g;
  const out = new Set();

  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) out.add(`var_${raw}`);
    else if (/^var_\d+$/i.test(raw)) out.add(raw.toLowerCase());
    else out.add(raw);
  }

  // ordena: var_1, var_2... primeiro; depois alfabético
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

  // monta 2 linhas exemplo
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

// =========================
// Helpers: Status / Permissões UI
// =========================
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

function canEditCampaign(c) {
  const st = String(c?.status || "").toLowerCase();
  return ["draft", "paused", "failed"].includes(st);
}
function canDeleteCampaign(c) {
  return String(c?.status || "").toLowerCase() === "draft";
}
function canStartCampaign(c) {
  const st = String(c?.status || "").toLowerCase();
  return ["draft", "paused"].includes(st);
}
function canPauseCampaign(c) {
  return String(c?.status || "").toLowerCase() === "running";
}
function canResumeCampaign(c) {
  return String(c?.status || "").toLowerCase() === "paused";
}
function canCancelCampaign(c) {
  const st = String(c?.status || "").toLowerCase();
  return ["draft", "running", "paused"].includes(st);
}

function getTemplateText(tpl) {
  // ✅ compat com vários formatos do backend
  return String(
    tpl?.text ||
      tpl?.message ||
      tpl?.content ||
      tpl?.body ||
      tpl?.contentText ||
      tpl?.metadata?.message ||
      ""
  ).trim();
}

export default function SmsCampaignCreateWizard({ mode = "create", initialCampaign = null, onExit }) {
  const [stepIndex, setStepIndex] = useState(0);

  const [campaign, setCampaign] = useState(initialCampaign);
  const [name, setName] = useState(initialCampaign?.name || "Campanha SMS");

  const [message, setMessage] = useState(
    initialCampaign?.message ||
      initialCampaign?.metadata?.message ||
      "Olá! 🙂\nQuer conhecer nossos serviços?"
  );

  // ✅ Templates SMS
  const [templates, setTemplates] = useState([]);
  const [templatesBusy, setTemplatesBusy] = useState(false);
  const [templateId, setTemplateId] = useState(
    initialCampaign?.templateId || initialCampaign?.metadata?.templateId || ""
  );

  // ✅ “Deseja salvar como modelo?”
  const [saveAsTemplate, setSaveAsTemplate] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState("");

  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const step = useMemo(() => STEPS[stepIndex], [stepIndex]);

  const messageRef = useRef(null);

  const editable = useMemo(() => {
    if (!campaign?.id) return true;
    return canEditCampaign(campaign);
  }, [campaign]);

  useEffect(() => {
    if (mode !== "edit" || !initialCampaign) return;

    const hasAudience =
      Number(initialCampaign?.audienceCount || 0) > 0 ||
      Number(initialCampaign?.audience?.total || 0) > 0 ||
      Array.isArray(initialCampaign?.audience?.rows);

    setStepIndex(hasAudience ? 1 : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Carrega modelos SMS (via api.ts, com headers + tenant)
  useEffect(() => {
    let alive = true;

    async function load() {
      setTemplatesBusy(true);
      try {
        const items = await fetchSmsTemplates();
        if (!alive) return;
        setTemplates(Array.isArray(items) ? items : []);
      } catch {
        if (!alive) return;
        setTemplates([]);
      } finally {
        if (alive) setTemplatesBusy(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  const detectedVars = useMemo(() => extractTemplateVars(message), [message]);

  const charCount = message?.length || 0;
  const smsParts = charCount <= 160 ? 1 : Math.ceil(charCount / 153);
  const charsLimit = smsParts === 1 ? 160 : smsParts * 153;

  function next() {
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStepIndex((s) => Math.max(s - 1, 0));
  }

  function handleDownloadTemplate() {
    setError("");
    setInfo("");
    const { csvText, headers, vars } = buildCsvTemplate({ message, delimiter: ";" });
    downloadTextFile({
      content: csvText,
      filename: `modelo_audiencia_sms_${filenameSafe(name)}.csv`
    });
    setInfo(
      `✅ Modelo baixado. Colunas: ${headers.join(" ; ")} • Variáveis: ${
        vars.length ? vars.join(", ") : "nenhuma"
      }`
    );
  }

  function insertVariable(varName) {
    if (!editable) return;

    const el = messageRef.current;
    if (!el) {
      setMessage((m) => `${String(m || "")}{{${varName}}}`);
      return;
    }

    const insert = `{{${varName}}}`;
    const start = el.selectionStart ?? String(message || "").length;
    const end = el.selectionEnd ?? String(message || "").length;

    const nextText = String(message || "").slice(0, start) + insert + String(message || "").slice(end);
    setMessage(nextText);

    requestAnimationFrame(() => {
      try {
        el.focus();
        const caret = start + insert.length;
        el.selectionStart = caret;
        el.selectionEnd = caret;
      } catch {}
    });
  }

  function handleInsertNextVar() {
    const varOnes = detectedVars
      .filter((k) => /^var_\d+$/i.test(k))
      .map((k) => Number(String(k).split("_")[1]))
      .filter((n) => Number.isFinite(n));

    const nextN = (varOnes.length ? Math.max(...varOnes) : 0) + 1;
    insertVariable(`var_${nextN}`);
  }

  function handleSelectTemplate(id) {
    setError("");
    setInfo("");
    setTemplateId(id);

    if (!id) return;

    const tpl = templates.find((t) => String(t.id) === String(id));
    if (!tpl) return;

    const text = getTemplateText(tpl);
    if (!text) return;

    if (!editable) return;

    setMessage(text);
    setInfo(`✅ Modelo aplicado: ${tpl.name}`);
  }

  async function handleCreateOrSave() {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const metadata = {
        ...(campaign?.metadata || {}),
        ...(templateId ? { templateId } : {})
      };

      let item;

      if (mode === "edit" && campaign?.id) {
        if (!canEditCampaign(campaign)) {
          setError("Esta campanha não pode ser editada no estado atual.");
          return;
        }

        const r = await updateSmsCampaign(campaign.id, { name, message, metadata });
        item = r?.item || r?.campaign || r;
        setCampaign(item);
        setInfo("✅ Alterações salvas.");
      } else {
        const r = await createSmsCampaign({ name, message, metadata });
        item = r?.item || r;
        setCampaign(item);
        setInfo("✅ Campanha criada.");
      }

      // ✅ salvar como modelo (se marcado)
      if (saveAsTemplate) {
        const modelName = String(saveTemplateName || name || "Modelo SMS").trim();
        if (!modelName) {
          setError("Informe o nome do modelo para salvar.");
          return;
        }

        try {
          await createSmsTemplate({
            name: modelName,
            text: message,
            message,
            status: "active",
            metadata: { source: "sms-campaign-wizard" }
          });
          setInfo((prev) => (prev ? `${prev}\n✅ Modelo salvo: ${modelName}` : `✅ Modelo salvo: ${modelName}`));
          setSaveAsTemplate(false);
          setSaveTemplateName("");
        } catch (e) {
          // não bloqueia fluxo de campanha se falhar modelo
          // eslint-disable-next-line no-console
          console.warn("Falha ao salvar modelo:", e);
        }
      }

      next();
    } catch (e) {
      setError(e?.message || "Erro ao salvar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!campaign?.id) return;

    if (!canDeleteCampaign(campaign)) {
      setError("Só é possível excluir campanhas em rascunho.");
      return;
    }

    const ok = window.confirm(
      `Excluir a campanha "${campaign?.name || "Campanha"}"?\nEssa ação não pode ser desfeita.`
    );
    if (!ok) return;

    setBusy(true);
    setError("");
    setInfo("");

    try {
      await deleteSmsCampaign(campaign.id);
      setInfo("✅ Campanha excluída.");
      onExit?.();
    } catch (e) {
      setError(e?.message || "Erro ao excluir campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!campaign?.id) return setError("Crie a campanha antes de importar a audiência.");
    if (!file) return setError("Selecione um arquivo CSV.");

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await uploadSmsCampaignAudience(campaign.id, file);
      if (r?.item) setCampaign(r.item);

      const count =
        r?.audienceCount ?? r?.imported ?? r?.item?.audience?.total ?? r?.item?.audienceCount ?? 0;

      setInfo(`✅ Audiência importada: ${count} número(s).`);
      next();
    } catch (e) {
      setError(e?.message || "Erro ao importar audiência.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartBatch() {
    if (!campaign?.id) return;

    if (!canStartCampaign(campaign)) {
      setError("Campanha não está em estado válido para iniciar/retomar.");
      return;
    }

    setBusy(true);
    setError("");
    setInfo("");

    try {
      // ✅ agora manda limit no BODY (resolve seu 400)
      const r = await startSmsCampaign(campaign.id, { limit: 200 });

      const nextStatus =
        String(r?.status || "").toLowerCase() || (r?.finished ? "finished" : "running");

      setCampaign((c) => (c ? { ...c, status: nextStatus, ...(r?.item ? r.item : {}) } : c));

      if (r?.finished) {
        setInfo(`✅ Finalizado. Enviados: ${r?.sent ?? 0} | Falhas: ${r?.failed ?? 0}`);
      } else {
        setInfo(
          `🚀 Processando em lotes… Enviados: ${r?.sent ?? 0} | Falhas: ${r?.failed ?? 0} • Clique em “Iniciar / Retomar” novamente para continuar.`
        );
      }
    } catch (e) {
      setError(e?.message || "Erro ao iniciar envio.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!campaign?.id) return;
    if (!canPauseCampaign(campaign)) return;

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await pauseSmsCampaign(campaign.id);
      const item = r?.item || r?.campaign || null;
      setCampaign(item || { ...campaign, status: "paused" });
      setInfo("⏸️ Envio pausado.");
    } catch (e) {
      setError(e?.message || "Erro ao pausar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!campaign?.id) return;
    if (!canResumeCampaign(campaign)) return;

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await resumeSmsCampaign(campaign.id);
      const item = r?.item || r?.campaign || null;
      setCampaign(item || { ...campaign, status: "draft" });
      setInfo("▶️ Pronto para continuar. Clique em “Iniciar / Retomar”.");
    } catch (e) {
      setError(e?.message || "Erro ao retomar.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!campaign?.id) return;
    if (!canCancelCampaign(campaign)) return;

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await cancelSmsCampaign(campaign.id);
      const item = r?.item || r?.campaign || null;
      setCampaign(item || { ...campaign, status: "canceled" });
      setInfo("⛔ Campanha cancelada.");
    } catch (e) {
      setError(e?.message || "Erro ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="campaign-wizard">
      <div className="wizard-steps">
        {STEPS.map((s, idx) => (
          <div
            key={s.key}
            className={`wizard-step ${idx === stepIndex ? "active" : ""} ${idx < stepIndex ? "done" : ""}`}
          >
            {s.label}
          </div>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      {step.key === "create" && (
        <div className="wizard-card" style={{ maxWidth: 920 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <h3 style={{ marginBottom: 6 }}>{mode === "edit" ? "Editar campanha" : "Criar campanha"}</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Defina nome e mensagem. Você pode usar um <b>modelo de SMS</b> para padronizar.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn secondary" type="button" onClick={handleDownloadTemplate} disabled={busy}>
                Baixar planilha exemplo
              </button>

              {campaign?.id && canDeleteCampaign(campaign) ? (
                <button className="btn secondary" type="button" onClick={handleDelete} disabled={busy}>
                  Excluir rascunho
                </button>
              ) : null}

              <button className="btn ghost" type="button" onClick={onExit} disabled={busy}>
                Fechar
              </button>

              <button className="btn primary" type="button" onClick={handleCreateOrSave} disabled={busy}>
                {busy ? "Salvando..." : mode === "edit" ? "Salvar" : "Criar"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14 }}>
            {/* FORM */}
            <div>
              <label className="field">
                <span>Nome</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy || !editable}
                  placeholder="Ex: Black Friday • SMS"
                />
              </label>

              {/* ✅ MODELO SMS */}
              <label className="field">
                <span>Modelo de SMS (opcional)</span>
                <select
                  value={templateId || ""}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  disabled={busy || !editable || templatesBusy}
                >
                  <option value="">— Selecionar modelo —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.status ? `(${t.status})` : ""}
                    </option>
                  ))}
                </select>
                <div className="muted" style={{ marginTop: 6 }}>
                  {templatesBusy
                    ? "Carregando modelos..."
                    : templates.length
                      ? "Ao selecionar um modelo, a mensagem será preenchida automaticamente."
                      : "Nenhum modelo encontrado (ou você não tem permissão)."}
                </div>
              </label>

              {/* ✅ SALVAR COMO MODELO */}
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  borderRadius: 10,
                  border: "1px solid rgba(255,255,255,.08)",
                  background: "rgba(255,255,255,.03)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12
                }}
              >
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={saveAsTemplate}
                    onChange={(e) => setSaveAsTemplate(e.target.checked)}
                    disabled={busy}
                  />
                  <span style={{ fontWeight: 600 }}>Deseja salvar como modelo?</span>
                </label>

                {saveAsTemplate ? (
                  <input
                    value={saveTemplateName}
                    onChange={(e) => setSaveTemplateName(e.target.value)}
                    placeholder="Nome do modelo (ex: Campanha_chegou)"
                    style={{ minWidth: 280 }}
                    disabled={busy}
                  />
                ) : null}
              </div>

              <label className="field" style={{ marginTop: 10 }}>
                <span>Mensagem</span>
                <textarea
                  ref={messageRef}
                  rows={7}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy || !editable}
                  style={{ resize: "vertical" }}
                  placeholder="Digite a mensagem do SMS..."
                />

                {/* Inserir variável (UX) */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                  <button
                    className="btn small secondary"
                    type="button"
                    onClick={() => insertVariable("var_1")}
                    disabled={busy || !editable}
                    title="Inserir {{var_1}} no cursor"
                  >
                    + var_1
                  </button>

                  <button
                    className="btn small secondary"
                    type="button"
                    onClick={handleInsertNextVar}
                    disabled={busy || !editable}
                    title="Cria a próxima var sequencial (var_2, var_3...)"
                  >
                    + nova variável
                  </button>

                  {detectedVars
                    .filter((v) => !/^var_\d+$/i.test(v))
                    .slice(0, 6)
                    .map((v) => (
                      <button
                        key={v}
                        className="btn small secondary"
                        type="button"
                        onClick={() => insertVariable(v)}
                        disabled={busy || !editable}
                        title={`Inserir {{${v}}}`}
                      >
                        + {v}
                      </button>
                    ))}
                </div>

                <div className="muted" style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
                  <span>
                    {charCount} caracteres • {smsParts} SMS
                  </span>
                  <span>Limite estimado: {charsLimit}</span>
                </div>
              </label>

              <div
                className="muted"
                style={{
                  marginTop: 10,
                  padding: 10,
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,.03)"
                }}
              >
                Variáveis detectadas: <b>{detectedVars.length ? detectedVars.join(", ") : "nenhuma"}</b>
              </div>

              {campaign?.id ? (
                <div className="muted" style={{ marginTop: 10 }}>
                  Status: <b>{statusLabel(campaign.status)}</b> • ID: <b>{String(campaign.id).slice(0, 12)}</b>
                </div>
              ) : null}
            </div>

            {/* PREVIEW */}
            <div
              style={{
                border: "1px solid rgba(255,255,255,.10)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(0,0,0,.25)"
              }}
            >
              <div className="muted" style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
                <span>Prévia</span>
                <span>{smsParts} parte(s)</span>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.06)",
                  minHeight: 180,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.35
                }}
              >
                {message || "Sua mensagem aparecerá aqui..."}
              </div>

              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                * Contagem estimada. Pode variar conforme acentos/Unicode.
              </div>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 14 }}>
            <button className="btn secondary" type="button" onClick={next} disabled={busy || !campaign?.id}>
              Próximo
            </button>
          </div>
        </div>
      )}

      {step.key === "audience" && (
        <div className="wizard-card" style={{ maxWidth: 920 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <h3>Audiência (CSV)</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                Coluna obrigatória: <b>numero</b>. As demais colunas devem bater com as variáveis do texto.
              </p>
              <div className="muted">
                Variáveis detectadas: <b>{detectedVars.length ? detectedVars.join(", ") : "nenhuma"}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn secondary" type="button" onClick={handleDownloadTemplate} disabled={busy}>
                Baixar planilha exemplo
              </button>
              <button className="btn secondary" type="button" onClick={back} disabled={busy}>
                Voltar
              </button>
              <button className="btn ghost" type="button" onClick={onExit} disabled={busy}>
                Fechar
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)"
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={busy}
            />

            <div style={{ marginTop: 12 }}>
              <p className="muted" style={{ marginBottom: 6 }}>
                Exemplo (gerado a partir do seu texto):
              </p>
              <pre className="code">{buildCsvTemplate({ message, delimiter: ";" }).csvText}</pre>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" type="button" onClick={handleUpload} disabled={busy || !campaign?.id}>
              {busy ? "Importando..." : "Importar audiência"}
            </button>
            <button className="btn secondary" type="button" onClick={next} disabled={busy}>
              Próximo
            </button>
          </div>
        </div>
      )}

      {step.key === "start" && (
        <div className="wizard-card" style={{ maxWidth: 920 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
            <div>
              <h3>Envio</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                Processa em lotes para evitar timeout. Clique em “Iniciar / Retomar” até finalizar.
              </p>
              <div className="muted">
                Status atual: <b>{statusLabel(campaign?.status)}</b>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn secondary" type="button" onClick={back} disabled={busy}>
                Voltar
              </button>
              <button className="btn ghost" type="button" onClick={onExit} disabled={busy}>
                Finalizar
              </button>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)"
            }}
          >
            <div className="muted" style={{ marginBottom: 8 }}>
              Campanha: <b>{campaign?.name || name}</b>
            </div>
            <div className="muted">
              Mensagem:{" "}
              <span style={{ opacity: 0.9 }}>
                {String(campaign?.message || campaign?.metadata?.message || message || "").slice(0, 160)}
                {String(campaign?.message || campaign?.metadata?.message || message || "").length > 160 ? "..." : ""}
              </span>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn primary"
              type="button"
              onClick={handleStartBatch}
              disabled={busy || !campaign?.id || !canStartCampaign(campaign)}
              title="Inicia ou continua o envio em lotes"
            >
              {busy ? "Processando..." : "Iniciar / Retomar"}
            </button>

            <button
              className="btn secondary"
              type="button"
              onClick={handlePause}
              disabled={busy || !campaign?.id || !canPauseCampaign(campaign)}
            >
              Pausar
            </button>

            <button
              className="btn secondary"
              type="button"
              onClick={handleResume}
              disabled={busy || !campaign?.id || !canResumeCampaign(campaign)}
            >
              Retomar
            </button>

            <button
              className="btn secondary"
              type="button"
              onClick={handleCancel}
              disabled={busy || !campaign?.id || !canCancelCampaign(campaign)}
            >
              Cancelar campanha
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
