// frontend/src/pages/outbound/sms/SmsCampaignCreateWizard.jsx
import { useMemo, useState } from "react";
import {
  createSmsCampaign,
  uploadSmsCampaignAudience,
  startSmsCampaign
} from "../../../api";
import "../../../styles/campaigns.css";

const STEPS = [
  { key: "create", label: "1. Criar campanha" },
  { key: "audience", label: "2. Carregar audiência" },
  { key: "start", label: "3. Iniciar campanha" }
];

export default function SmsCampaignCreateWizard({ onExit }) {
  const [stepIndex, setStepIndex] = useState(0);

  const [campaign, setCampaign] = useState(null);
  const [name, setName] = useState("Campanha SMS");
  const [message, setMessage] = useState("Olá! Aqui é a GP Labs 🙂");
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const step = useMemo(() => STEPS[stepIndex], [stepIndex]);

  const EXAMPLE_TEXT = "{{1}}";
  const EXAMPLE_VAR = "{{var_1}}";

  function next() {
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepIndex((s) => Math.max(s - 1, 0));
  }

  async function handleCreate() {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await createSmsCampaign({ name, message });
      setCampaign(r.item);
      setInfo("Campanha criada com sucesso.");
      next();
    } catch (e) {
      setError(e?.message || "Erro ao criar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload() {
    if (!campaign?.id) return;

    if (!file) {
      setError("Selecione um arquivo CSV.");
      return;
    }

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await uploadSmsCampaignAudience(campaign.id, file);
      setInfo(`Audiência importada: ${r.audienceCount} números.`);
      next();
    } catch (e) {
      setError(e?.message || "Erro ao importar audiência.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStart() {
    if (!campaign?.id) return;

    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await startSmsCampaign(campaign.id);
      setInfo(
        `Disparo finalizado. Enviados: ${r.sent} | Falhas: ${r.failed} | Status: ${r.status}`
      );
    } catch (e) {
      setError(e?.message || "Erro ao iniciar disparo.");
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
            className={`wizard-step ${idx === stepIndex ? "active" : ""} ${
              idx < stepIndex ? "done" : ""
            }`}
          >
            {s.label}
          </div>
        ))}
      </div>

      {error && <div className="alert error">{error}</div>}
      {info && <div className="alert ok">{info}</div>}

      {step.key === "create" && (
        <div className="wizard-card">
          <h3>Criar campanha</h3>

          <label className="field">
            <span>Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />
          </label>

          <label className="field">
            <span>Mensagem</span>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              disabled={busy}
            />
          </label>

          <div className="wizard-actions">
            <button className="btn secondary" onClick={onExit} disabled={busy}>
              Cancelar
            </button>
            <button className="btn primary" onClick={handleCreate} disabled={busy}>
              {busy ? "Criando..." : "Criar"}
            </button>
          </div>

          <p className="muted" style={{ marginTop: 10 }}>
            Dica: se quiser personalizar, use no texto{" "}
            <b>{EXAMPLE_TEXT}</b> ou <b>{EXAMPLE_VAR}</b> e no CSV crie a coluna{" "}
            <b>var_1</b>.
          </p>
        </div>
      )}

      {step.key === "audience" && (
        <div className="wizard-card">
          <h3>Carregar audiência (CSV)</h3>

          <p className="muted">
            Header obrigatório: <b>numero</b> (ou <b>phone</b>). Opcional:{" "}
            <b>var_1</b>, <b>var_2</b>...
          </p>

          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={busy}
          />

          <div className="wizard-actions">
            <button className="btn secondary" onClick={back} disabled={busy}>
              Voltar
            </button>
            <button className="btn primary" onClick={handleUpload} disabled={busy}>
              {busy ? "Importando..." : "Importar"}
            </button>
          </div>
        </div>
      )}

      {step.key === "start" && (
        <div className="wizard-card">
          <h3>Iniciar disparo</h3>
          <p className="muted">
            O envio será sequencial para manter rastreio por destinatário.
          </p>

          <div className="wizard-actions">
            <button className="btn secondary" onClick={back} disabled={busy}>
              Voltar
            </button>
            <button className="btn primary" onClick={handleStart} disabled={busy}>
              {busy ? "Enviando..." : "Iniciar"}
            </button>
            <button className="btn ghost" onClick={onExit} disabled={busy}>
              Finalizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
