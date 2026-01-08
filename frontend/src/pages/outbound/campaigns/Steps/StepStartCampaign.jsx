// frontend/src/pages/outbound/campaigns/steps/StepStartCampaign.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { mpTrack } from "../../../../lib/mixpanel";

export default function StepStartCampaign({
  campaignId,
  form,
  number,
  template,
  audience,
  onBack,
  onStart
}) {
  const [agree, setAgree] = useState(false);
  const trackedViewRef = useRef(false);

  const total = useMemo(
    () => audience?.validRows || audience?.totalRows || 0,
    [audience]
  );

  const propsBase = useMemo(() => {
    return {
      campaign_id: campaignId ?? null,
      campaign_name: String(form?.name || "").trim(),
      number_id: String(form?.numberId || "").trim(),
      number_display: String(number?.phone || number?.displayName || "").trim(),
      template_name: String(template?.name || form?.templateName || "").trim(),
      template_language: String(template?.language || "").trim(),
      exclude_opt_out: Boolean(form?.excludeOptOut),
      audience_file: String(audience?.fileName || "").trim(),
      audience_total_rows: Number(audience?.totalRows ?? 0),
      audience_valid_rows: Number(audience?.validRows ?? 0),
      audience_invalid_rows: Number(audience?.invalidRows ?? 0),
      total_to_send: Number(total ?? 0)
    };
  }, [campaignId, form, number, template, audience, total]);

  // Track view (1x)
  useEffect(() => {
    if (trackedViewRef.current) return;
    trackedViewRef.current = true;

    mpTrack("campaign_wizard_start_step_view", {
      ...propsBase
    });
  }, [propsBase]);

  function handleBack() {
    mpTrack("campaign_wizard_back_clicked", {
      step: "start",
      campaign_id: campaignId ?? null
    });
    onBack?.();
  }

  async function handleStart() {
    if (!agree) {
      mpTrack("campaign_start_blocked", {
        ...propsBase,
        reason: "terms_not_accepted"
      });
      return;
    }

    mpTrack("campaign_start_clicked", {
      ...propsBase,
      terms_accepted: true
    });

    try {
      await onStart?.();

      mpTrack("campaign_start_success", {
        ...propsBase,
        terms_accepted: true
      });
    } catch (e) {
      const msg = String(e?.message || "Erro ao iniciar campanha.");
      mpTrack("campaign_start_error", {
        ...propsBase,
        terms_accepted: true,
        error: msg
      });
      // mantém o comportamento atual: não quebra UI
      throw e;
    }
  }

  return (
    <div className="cmp-grid-1">
      <div className="cmp-card" style={{ textAlign: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          Você está prestes a iniciar sua campanha!
        </h2>

        <div className="cmp-subtitle" style={{ marginTop: 8 }}>
          Ao iniciar, o sistema começará a enviar mensagens ao seu público.
        </div>

        <div
          className="cmp-card"
          style={{
            marginTop: 16,
            borderColor: "rgba(59,130,246,0.35)",
            background: "rgba(59,130,246,0.06)",
            display: "inline-block",
            textAlign: "left",
            minWidth: "min(860px, 100%)"
          }}
        >
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <div className="cmp-subtitle">Custo estimado (MVP)</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>$ —</div>
            <div className="cmp-hint">
              Vamos calcular depois com base em conversa/entrega.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr 1fr",
              gap: 10
            }}
          >
            <div>
              <div className="cmp-hint">Nome da campanha</div>
              <div style={{ fontWeight: 600 }}>{form.name || "—"}</div>
            </div>

            <div>
              <div className="cmp-hint">A partir de</div>
              <div style={{ fontWeight: 600 }}>
                {number?.phone || number?.displayName || form.numberId || "—"}
              </div>
            </div>

            <div>
              <div className="cmp-hint">Template</div>
              <div style={{ fontWeight: 600 }}>
                {template?.name || form.templateName || "—"}
              </div>
            </div>

            <div>
              <div className="cmp-hint">Audiência</div>
              <div style={{ fontWeight: 600 }}>{audience?.fileName || "—"}</div>
            </div>
          </div>

          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between"
            }}
          >
            <div className="cmp-pill">
              <span className="cmp-ok">●</span> Total de postagens:{" "}
              <strong>{total}</strong>
            </div>
            <div className="cmp-pill">
              <span className="cmp-ok">●</span> Campaign ID:{" "}
              <strong>{campaignId}</strong>
            </div>
          </div>
        </div>

        <label className="cmp-check" style={{ justifyContent: "center" }}>
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => {
              const v = e.target.checked;
              setAgree(v);

              mpTrack("campaign_terms_toggle", {
                ...propsBase,
                checked: v
              });
            }}
          />
          <span>Eu concordo com os termos e política de privacidade</span>
        </label>

        <div className="cmp-actions" style={{ justifyContent: "center" }}>
          <button className="cmp-btn" onClick={handleBack}>
            Voltar
          </button>

          <button
            className="cmp-btn cmp-btn-primary"
            disabled={!agree}
            onClick={handleStart}
            title={!agree ? "Aceite os termos para iniciar" : "Iniciar campanha"}
          >
            Iniciar campanha
          </button>
        </div>
      </div>
    </div>
  );
}
