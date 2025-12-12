import { useMemo, useState } from "react";

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

  const total = useMemo(() => audience?.validRows || audience?.totalRows || 0, [audience]);

  return (
    <div className="cmp-grid-1">
      <div className="cmp-card" style={{ textAlign: "center" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Você está prestes a iniciar sua campanha!</h2>
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
            <div className="cmp-hint">Vamos calcular depois com base em conversa/entrega.</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
            <div>
              <div className="cmp-hint">Nome da campanha</div>
              <div style={{ fontWeight: 600 }}>{form.name || "—"}</div>
            </div>
            <div>
              <div className="cmp-hint">A partir de</div>
              <div style={{ fontWeight: 600 }}>{number?.phone || number?.displayName || form.numberId || "—"}</div>
            </div>
            <div>
              <div className="cmp-hint">Template</div>
              <div style={{ fontWeight: 600 }}>{template?.name || form.templateName || "—"}</div>
            </div>
            <div>
              <div className="cmp-hint">Audiência</div>
              <div style={{ fontWeight: 600 }}>{audience?.fileName || "—"}</div>
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <div className="cmp-pill">
              <span className="cmp-ok">●</span> Total de postagens: <strong>{total}</strong>
            </div>
            <div className="cmp-pill">
              <span className="cmp-ok">●</span> Campaign ID: <strong>{campaignId}</strong>
            </div>
          </div>
        </div>

        <label className="cmp-check" style={{ justifyContent: "center" }}>
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>Eu concordo com os termos e política de privacidade</span>
        </label>

        <div className="cmp-actions" style={{ justifyContent: "center" }}>
          <button className="cmp-btn" onClick={onBack}>Voltar</button>
          <button
            className="cmp-btn cmp-btn-primary"
            disabled={!agree}
            onClick={onStart}
          >
            Iniciar campanha
          </button>
        </div>
      </div>
    </div>
  );
}

