// frontend/src/pages/outbound/sms/SmsCampaignCreateWizard.jsx
import { useMemo, useState } from "react";
import {
  createSmsCampaign,
  updateSmsCampaign,
  deleteSmsCampaign,
  uploadSmsCampaignAudience,
  startSmsCampaign,
  pauseSmsCampaign,
  resumeSmsCampaign,
  cancelSmsCampaign
} from "../../../api";
import "../../../styles/campaigns.css";

const STEPS = [
  { key: "create", label: "1. Criar campanha" },
  { key: "audience", label: "2. Carregar audiência" },
  { key: "start", label: "3. Iniciar envio" }
];

// =========================
// Helpers CSV / Template
// =========================
function filenameSafe(s) {
  return String(s || "")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function extractTemplateVars(message) {
  const re = /{{\s*([^}]+?)\s*}}/g;
  const out = new Set();
  let m;

  while ((m = re.exec(String(message || ""))) !== null) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) out.add(`var_${raw}`);
    else if (/^var_\d+$/i.test(raw)) out.add(raw.toLowerCase());
    else out.add(raw);
  }

  const vars = Array.from(out);
  const numbered = vars
    .filter(v => /^var_\d+$/i.test(v))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));
  const named = vars.filter(v => !/^var_\d+$/i.test(v)).sort();

  return [...numbered, ...named];
}

function buildCsvTemplate(message) {
  const vars = extractTemplateVars(message);
  const headers = ["numero", ...vars];

  const row1 = ["5511999999999"];
  const row2 = ["5511988887777"];

  vars.forEach(v => {
    row1.push(`${v}_A`);
    row2.push(`${v}_B`);
  });

  return [
    headers.join(";"),
    row1.join(";"),
    row2.join(";")
  ].join("\n");
}

function downloadCsv(content, name) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// =========================
// Wizard
// =========================
export default function SmsCampaignCreateWizard({
  mode = "create",
  initialCampaign,
  onExit
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [campaign, setCampaign] = useState(initialCampaign || null);

  const [name, setName] = useState(initialCampaign?.name || "Campanha SMS");
  const [message, setMessage] = useState(
    initialCampaign?.metadata?.message ||
      "Olá! Aqui é a GP Labs 🙂\nQuer conhecer nossos serviços?"
  );
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const step = STEPS[stepIndex];
  const detectedVars = useMemo(() => extractTemplateVars(message), [message]);

  function next() {
    setStepIndex(s => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStepIndex(s => Math.max(s - 1, 0));
  }

  function downloadTemplate() {
    const csv = buildCsvTemplate(message);
    downloadCsv(csv, `modelo_audiencia_${filenameSafe(name)}.csv`);
    setInfo("✅ Planilha modelo baixada conforme a mensagem.");
  }

  // =========================
  // Actions
  // =========================
  async function handleCreateOrUpdate() {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const payload = { name, message };

      const r =
        mode === "edit" && campaign?.id
          ? await updateSmsCampaign(campaign.id, payload)
          : await createSmsCampaign(payload);

      setCampaign(r.item);
      setInfo("✅ Campanha salva com sucesso.");
      next();
    } catch (e) {
      setError(e?.message || "Erro ao salvar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!campaign?.id || !file) return;
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await uploadSmsCampaignAudience(campaign.id, file);
      setInfo(`✅ Audiência importada: ${r.imported || r.audienceCount || 0}`);
      next();
    } catch (e) {
      setError(e?.message || "Erro ao importar audiência.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    setBusy(true);
    setError("");
    try {
      await startSmsCampaign(campaign.id);
      setInfo("🚀 Envio iniciado.");
    } catch (e) {
      setError(e?.message || "Erro ao iniciar envio.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    setBusy(true);
    await pauseSmsCampaign(campaign.id);
    setInfo("⏸️ Campanha pausada.");
    setBusy(false);
  }

  async function handleResume() {
    setBusy(true);
    await resumeSmsCampaign(campaign.id);
    setInfo("▶️ Campanha pronta para continuar.");
    setBusy(false);
  }

  async function handleCancel() {
    setBusy(true);
    await cancelSmsCampaign(campaign.id);
    setInfo("❌ Campanha cancelada.");
    setBusy(false);
  }

  async function handleDelete() {
    if (!campaign || campaign.status !== "draft") return;
    if (!window.confirm("Excluir campanha rascunho?")) return;

    setBusy(true);
    try {
      await deleteSmsCampaign(campaign.id);
      onExit();
    } catch (e) {
      setError(e?.message || "Erro ao excluir campanha.");
    } finally {
      setBusy(false);
    }
  }

  // =========================
  // UI
  // =========================
  return (
    <div className="campaign-wizard">
      <div className="wizard-steps">
        {STEPS.map((s, i) => (
          <div key={s.key} className={`wizard-step ${i === stepIndex ? "active" : ""}`}>
            {s.label}
          </div>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      {step.key === "create" && (
        <div className="wizard-card">
          <label className="field">
            <span>Nome</span>
            <input value={name} onChange={e => setName(e.target.value)} />
          </label>

          <label className="field">
            <span>Mensagem</span>
            <textarea rows={5} value={message} onChange={e => setMessage(e.target.value)} />
          </label>

          <div className="muted">
            Variáveis detectadas: <b>{detectedVars.join(", ") || "nenhuma"}</b>
          </div>

          <div className="wizard-actions">
            <button className="btn secondary" onClick={downloadTemplate}>
              Baixar planilha exemplo
            </button>

            {campaign?.status === "draft" && (
              <button className="btn danger" onClick={handleDelete}>
                Excluir rascunho
              </button>
            )}

            <button className="btn primary" onClick={handleCreateOrUpdate} disabled={busy}>
              Salvar
            </button>
          </div>
        </div>
      )}

      {step.key === "audience" && (
        <div className="wizard-card">
          <input type="file" accept=".csv" onChange={e => setFile(e.target.files[0])} />
          <div className="wizard-actions">
            <button className="btn secondary" onClick={back}>Voltar</button>
            <button className="btn primary" onClick={handleUpload} disabled={busy}>
              Importar audiência
            </button>
          </div>
        </div>
      )}

      {step.key === "start" && (
        <div className="wizard-card">
          <div className="wizard-actions">
            <button className="btn primary" onClick={handleStart}>Iniciar</button>
            <button className="btn secondary" onClick={handlePause}>Pausar</button>
            <button className="btn secondary" onClick={handleResume}>Retomar</button>
            <button className="btn danger" onClick={handleCancel}>Cancelar</button>
            <button className="btn ghost" onClick={onExit}>Finalizar</button>
          </div>
        </div>
      )}
    </div>
  );
}
