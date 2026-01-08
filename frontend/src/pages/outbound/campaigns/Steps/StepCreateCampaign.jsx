// frontend/src/pages/outbound/campaigns/Steps/StepCreateCampaign.jsx
import { useEffect, useRef } from "react";
import { mpTrack } from "../../../../lib/mixpanel";

function safeTrim(v) {
  return String(v ?? "").trim();
}

export default function StepCreateCampaign({
  numbers,
  templates,
  form,
  setForm,
  onNext,
  loading
}) {
  // evita track duplicado quando React strict mode roda efeitos 2x em DEV
  const onceRef = useRef(false);

  useEffect(() => {
    if (onceRef.current) return;
    onceRef.current = true;

    mpTrack("campaign_wizard_create_step_view", {
      numbers_count: Array.isArray(numbers) ? numbers.length : 0,
      templates_count: Array.isArray(templates) ? templates.length : 0
    });
  }, [numbers, templates]);

  function trackField(name, extra = {}) {
    try {
      mpTrack(name, extra);
    } catch {
      // noop
    }
  }

  function onNameChange(v) {
    const value = String(v ?? "");
    setForm((f) => ({ ...f, name: value }));

    // não envia o texto do nome (pode ter dados)
    trackField("campaign_create_name_changed", {
      has_name: Boolean(safeTrim(value)),
      name_len: value.length
    });
  }

  function onNumberChange(v) {
    const id = safeTrim(v);
    setForm((f) => ({ ...f, numberId: id }));

    trackField("campaign_create_number_selected", {
      number_id: id || ""
    });
  }

  function onTemplateChange(v) {
    const name = safeTrim(v);
    setForm((f) => ({ ...f, templateName: name }));

    const t = Array.isArray(templates) ? templates.find((x) => String(x?.name) === name) : null;

    trackField("campaign_create_template_selected", {
      template_name: name || "",
      template_category: safeTrim(t?.category) || ""
    });
  }

  function onExcludeOptOutChange(checked) {
    const value = Boolean(checked);
    setForm((f) => ({ ...f, excludeOptOut: value }));

    trackField("campaign_create_exclude_optout_toggled", {
      exclude_opt_out: value
    });
  }

  function handleNextClick() {
    trackField("campaign_create_next_clicked", {
      has_name: Boolean(safeTrim(form?.name)),
      has_number: Boolean(safeTrim(form?.numberId)),
      has_template: Boolean(safeTrim(form?.templateName)),
      exclude_opt_out: Boolean(form?.excludeOptOut)
    });

    onNext?.();
  }

  return (
    <div className="cmp-grid">
      <div className="cmp-card">
        <h2 style={{ margin: 0, fontSize: 16 }}>Criar campanha</h2>
        <div className="cmp-subtitle" style={{ marginBottom: 12 }}>
          Defina nome, número remetente e template.
        </div>

        <div className="cmp-row">
          <div className="cmp-field">
            <label>Nome da campanha *</label>
            <input
              value={form.name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Ex.: Black Friday Dezembro"
            />
          </div>

          <div className="cmp-field">
            <label>A partir de (número) *</label>
            <select value={form.numberId} onChange={(e) => onNumberChange(e.target.value)}>
              <option value="">Selecione...</option>
              {numbers.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.displayName || n.phone || n.id}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="cmp-field" style={{ marginTop: 12 }}>
          <label>Template *</label>
          <select value={form.templateName} onChange={(e) => onTemplateChange(e.target.value)}>
            <option value="">Selecione...</option>
            {templates.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} ({t.category || "—"})
              </option>
            ))}
          </select>
        </div>

        <div className="cmp-check">
          <input
            type="checkbox"
            checked={!!form.excludeOptOut}
            onChange={(e) => onExcludeOptOutChange(e.target.checked)}
          />
          <span>Excluir contatos em Opt-out (recomendado)</span>
        </div>

        <div className="cmp-actions">
          <button
            className="cmp-btn cmp-btn-primary"
            onClick={handleNextClick}
            disabled={!!loading}
            title={loading ? "Aguarde..." : "Prosseguir"}
          >
            {loading ? "Aguarde..." : "Prosseguir"}
          </button>
        </div>
      </div>

      <div className="cmp-card">
        <h2 style={{ margin: 0, fontSize: 16 }}>Prévia</h2>
        <div className="cmp-subtitle" style={{ marginBottom: 10 }}>
          Depois vamos carregar audiência e iniciar.
        </div>

        <div className="cmp-pill" style={{ marginBottom: 8 }}>
          <span className="cmp-ok">●</span> Fluxo em 3 passos
        </div>
        <div className="cmp-pill" style={{ marginBottom: 8 }}>
          <span className="cmp-warn">●</span> MVP: custo estimado depois
        </div>
        <div className="cmp-pill">
          <span className="cmp-ok">●</span> Status e logs no backend
        </div>
      </div>
    </div>
  );
}
