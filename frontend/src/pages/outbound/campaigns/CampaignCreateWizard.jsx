// frontend/src/pages/outbound/campaigns/CampaignCreateWizard.jsx
import { useEffect, useMemo, useState } from "react";
import { mpTrack } from "../../../lib/mixpanel";

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

function safeTrim(v) {
  return String(v ?? "").trim();
}

function safeMsg(e) {
  return String(e?.message || e || "").slice(0, 160);
}

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

  // ✅ tracking helper (silencioso)
  function t(name, props = {}) {
    try {
      mpTrack(name, props);
    } catch {
      // noop
    }
  }

  // ✅ Wizard open
  useEffect(() => {
    t("campaign_wizard_open", { entry_step: step || "create" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ Track step views
  useEffect(() => {
    t("campaign_wizard_step_view", {
      step: step || "",
      step_index: Number(stepIndex),
      has_campaign_id: Boolean(campaignId)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIndex]);

  useEffect(() => {
    let alive = true;

    async function boot() {
      setBootLoading(true);
      setErr("");
      setSuccess("");

      t("campaign_wizard_boot_submit", {});

      try {
        const [nums, temps] = await Promise.all([fetchNumbers(), fetchTemplates()]);
        if (!alive) return;

        const n = Array.isArray(nums) ? nums : [];
        const tt = Array.isArray(temps) ? temps : [];

        setNumbers(n);
        setTemplates(tt);

        t("campaign_wizard_boot_success", {
          numbers_count: n.length,
          templates_count: tt.length
        });
      } catch (e) {
        if (!alive) return;
        setErr(e?.message || "Falha ao carregar números/templates.");

        t("campaign_wizard_boot_error", { message: safeMsg(e) });
      } finally {
        if (!alive) return;
        setBootLoading(false);
      }
    }

    boot();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    t("campaign_wizard_exit_click", {
      step: step || "",
      step_index: Number(stepIndex),
      has_campaign_id: Boolean(campaignId)
    });

    if (typeof onExit === "function") return onExit();
    if (window.history.length > 1) window.history.back();
  }

  async function handleCreateCampaign() {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    const name = safeTrim(form?.name);
    const numberId = safeTrim(form?.numberId);
    const templateName = safeTrim(form?.templateName);
    const templateLanguage = safeTrim(selectedTemplate?.language) || "pt_BR";
    const excludeOptOut = Boolean(form?.excludeOptOut);

    // ⚠️ Não manda "name" pro mixpanel (pode conter info), só flags/ids
    t("campaign_create_submit", {
      has_name: Boolean(name),
      number_id: numberId || "",
      template_name: templateName || "",
      template_language: templateLanguage,
      exclude_opt_out: excludeOptOut
    });

    try {
      if (!name || !numberId || !templateName) {
        setErr("Preencha nome, número e template.");
        t("campaign_create_error", { message: "validation_error" });
        return;
      }

      const res = await createCampaign({
        name,
        numberId: String(numberId),
        templateName: String(templateName),
        templateLanguage,
        excludeOptOut
      });

      const id = res?.id;
      if (!id) throw new Error("API não retornou id da campanha.");

      setCampaignId(id);

      t("campaign_create_success", {
        campaign_id: String(id),
        template_language: templateLanguage,
        exclude_opt_out: excludeOptOut
      });

      setSuccess("Campanha criada. Agora vamos carregar a audiência.");
      goNextStep();
    } catch (e) {
      setErr(e?.message || "Erro ao criar campanha.");
      t("campaign_create_error", { message: safeMsg(e) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUploadAudience(file) {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    const fileName = safeTrim(file?.name);

    t("campaign_audience_upload_submit", {
      has_campaign_id: Boolean(campaignId),
      file_ext: fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : "",
      // não envia nome do arquivo (pode ter dado sensível)
      has_file: Boolean(file)
    });

    try {
      if (!campaignId) throw new Error("Campanha ainda não foi criada.");
      if (!file) throw new Error("Selecione um arquivo CSV.");

      const res = await uploadCampaignAudience(campaignId, file);

      const nextAudience = {
        fileName: res?.fileName || file?.name || "",
        totalRows: Number(res?.totalRows ?? 0),
        validRows: Number(res?.validRows ?? 0),
        invalidRows: Number(res?.invalidRows ?? 0)
      };

      setAudience(nextAudience);

      t("campaign_audience_upload_success", {
        campaign_id: String(campaignId),
        total_rows: nextAudience.totalRows,
        valid_rows: nextAudience.validRows,
        invalid_rows: nextAudience.invalidRows
      });

      setSuccess("Audiência carregada. Agora é só iniciar a campanha.");
      goNextStep();
    } catch (e) {
      setErr(e?.message || "Erro ao enviar audiência.");
      t("campaign_audience_upload_error", { message: safeMsg(e) });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStartCampaign() {
    setErr("");
    setSuccess("");
    setActionLoading(true);

    t("campaign_start_submit", {
      has_campaign_id: Boolean(campaignId),
      exclude_opt_out: Boolean(form?.excludeOptOut),
      template_language: safeTrim(selectedTemplate?.language) || "pt_BR",
      audience_total_rows: Number(audience?.totalRows ?? 0),
      audience_valid_rows: Number(audience?.validRows ?? 0)
    });

    try {
      if (!campaignId) throw new Error("Campanha ainda não foi criada.");

      await startCampaign(campaignId);

      t("campaign_start_success", {
        campaign_id: String(campaignId),
        audience_total_rows: Number(audience?.totalRows ?? 0),
        audience_valid_rows: Number(audience?.validRows ?? 0)
      });

      setSuccess("✅ Campanha iniciada com sucesso!");
      // opcional: se quiser sair automático após iniciar:
      // if (typeof onExit === "function") onExit();
    } catch (e) {
      setErr(e?.message || "Erro ao iniciar campanha.");
      t("campaign_start_error", { message: safeMsg(e) });
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
              template={selectedTemplate} // ✅ AJUSTE: exemplo do CSV vira dinâmico pelo template
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
