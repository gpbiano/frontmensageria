// frontend/src/pages/outbound/campaigns/CampaignCreateWizard.jsx
import { useEffect, useMemo, useState } from "react";

// ✅ CSS está em /src/styles
import "../../../styles/campaigns.css";

// ✅ Usa sua API central (api.ts)
import {
  fetchNumbers,
  fetchTemplates,
  createCampaign,
  uploadCampaignAudience,
  startCampaign
} from "../../../api";

// Steps
import StepCreateCampaign from "./Steps/StepCreateCampaign.jsx";
import StepUploadAudience from "./Steps/StepUploadAudience.jsx";
import StepStartCampaign from "./Steps/StepStartCampaign.jsx";

const STEPS = [
  { key: "create", label: "1. Criar campanha" },
  { key: "audience", label: "2. Carregar audiência" },
  { key: "start", label: "3. Iniciar campanha" }
];

export default function CampaignCreateWizard({ onExit }) {
  const [stepIndex, setStepIndex] = useState(0);

  const [numbers, setNumbers] = useState([]);
  const [templates, setTemplates] = useState([]);

  const [bootLoading, setBootLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [err, setErr] = useState("");
  const [success, setSuccess] = useState("");

  const [campaignId, setCampaignId] = useState(null);

  // Form state
  const [form, setForm] = useState({
    name: "",
    numberId: "",
    templateName: "",
    excludeOptOut: true
  });

  // Audience state
  const [audience, setAudience] = useState({
    fileName: "",
    totalRows: 0,
    validRows: 0,
    invalidRows: 0
  });

  const step = STEPS[stepIndex]?.key;

  useEffect(() => {
    let alive = true;

    async function boot() {
      setBootLoading(true);
      setErr("");
      setSuccess("");

      try {
        const [nums, temps] = await Promise.all([fetchNumbers(), fetchTemplates()]);
        if (!alive) return;

        setNumbers(Array.isArray(nums) ? nums : []);
        setTemplates(Array.isArray(temps) ? temps : []);
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Falha ao carregar números/templates.");
      } finally {
        if (!alive) return;
        setBootLoading(false);
      }
    }

    boot();
    return () => {
      alive = false;
    };
  }, []);

  const selectedNumber = useMemo(() => {
    // tolera variações de shape (id / phone_number_id / numberId)
    return (
      numbers.find((n) => String(n?.id) === String(form.numberId)) ||
      numbers.find((n) => String(n?.phone_number_id) === String(form.numberId)) ||
      numbers.find((n) => String(n?.numberId) === String(form.numberId)) ||
      null
    );
  }, [numbers, form.numberId]);

  const selectedTemplate = useMemo(() => {
    return templates.find((t) => String(t?.name) === String(form.templateName)) || null;
  }, [templates, form.templateName]);

  function goBackStep() {
    setErr("");
    setStepIndex((s) => Math.max(0, s - 1));
  }

  function goNextStep() {
    setErr("");
    setStepIndex((s) => Math.min(STEPS.length - 1, s + 1));
  }

  function topBack() {
    if (typeof onExit === "function") return onExit();
    if (window.history.length > 1) window.history.back();
  }

  async function handleCreateCampaign() {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    try {
      if (!form.name?.trim() || !form.numberId || !form.templateName) {
        setErr("Preencha nome, número e template.");
        return;
      }

      const res = await createCampaign({
  name: form.name.trim(),
  numberId: String(form.numberId),
  templateName: String(form.templateName),
  templateLanguage: selectedTemplate?.language || "pt_BR",
  excludeOptOut: !!form.excludeOptOut
});

      const id = res?.id;
      if (!id) throw new Error("API não retornou id da campanha.");

      setCampaignId(id);
      setSuccess("Campanha criada. Agora vamos carregar a audiência.");
      goNextStep();
    } catch (e) {
      setErr(e?.message || "Erro ao criar campanha.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadAudience(file) {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    try {
      if (!campaignId) throw new Error("Campanha ainda não foi criada.");
      if (!file) throw new Error("Selecione um arquivo CSV.");

      const res = await uploadCampaignAudience(campaignId, file);

      setAudience({
        fileName: res?.fileName || file?.name || "",
        totalRows: Number(res?.totalRows ?? 0),
        validRows: Number(res?.validRows ?? 0),
        invalidRows: Number(res?.invalidRows ?? 0)
      });

      setSuccess("Audiência carregada. Agora é só iniciar a campanha.");
      goNextStep();
    } catch (e) {
      setErr(e?.message || "Erro ao enviar audiência.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStartCampaign() {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    try {
      if (!campaignId) throw new Error("Campanha ainda não foi criada.");

      await startCampaign(campaignId);

      setSuccess("✅ Campanha iniciada com sucesso!");
      // opcional: se quiser sair automático após iniciar:
      // if (typeof onExit === "function") onExit();
    } catch (e) {
      setErr(e?.message || "Erro ao iniciar campanha.");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="cmp-wrap">
      <div className="cmp-header">
        <div>
          <h1>Campanhas</h1>
          <div className="cmp-subtitle">
            Criação em 3 passos (igual Aivo): Criar → Audiência → Iniciar.
          </div>
        </div>

        <button
          className="cmp-btn"
          onClick={topBack}
          title="Voltar"
          disabled={actionLoading}
        >
          Voltar
        </button>
      </div>

      <div className="cmp-steps">
        {STEPS.map((s, i) => (
          <div
            key={s.key}
            className={"cmp-step " + (i === stepIndex ? "cmp-step-active" : "")}
          >
            <strong>{s.label}</strong>
          </div>
        ))}
      </div>

      {err ? (
        <div className="cmp-card" style={{ borderColor: "rgba(239,68,68,0.35)" }}>
          <div className="cmp-pill">
            <span className="cmp-err">●</span> {err}
          </div>
        </div>
      ) : null}

      {success ? (
        <div className="cmp-card" style={{ borderColor: "rgba(34,197,94,0.30)" }}>
          <div className="cmp-pill">
            <span className="cmp-ok">●</span> {success}
          </div>
        </div>
      ) : null}

      {bootLoading ? (
        <div className="cmp-card">Carregando números e templates…</div>
      ) : (
        <>
          {step === "create" && (
            <StepCreateCampaign
              numbers={numbers}
              templates={templates}
              form={form}
              setForm={setForm}
              onNext={handleCreateCampaign}
              loading={actionLoading}
            />
          )}

          {step === "audience" && (
            <StepUploadAudience
              campaignId={campaignId}
              template={selectedTemplate}   // ✅ AJUSTE: exemplo do CSV vira dinâmico pelo template
              onBack={goBackStep}
              onNext={handleUploadAudience}
              loading={actionLoading}
            />
          )}

          {step === "start" && (
            <StepStartCampaign
              campaignId={campaignId}
              form={form}
              number={selectedNumber}
              template={selectedTemplate}
              audience={audience}
              onBack={goBackStep}
              onStart={handleStartCampaign}
              loading={actionLoading}
            />
          )}
        </>
      )}
    </div>
  );
}
