export default function StepCreateCampaign({
  numbers,
  templates,
  form,
  setForm,
  onNext
}) {
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
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
              placeholder="Ex.: Black Friday Dezembro"
            />
          </div>

          <div className="cmp-field">
            <label>A partir de (número) *</label>
            <select
              value={form.numberId}
              onChange={(e) =>
                setForm((f) => ({ ...f, numberId: e.target.value }))
              }
            >
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
          <select
            value={form.templateName}
            onChange={(e) =>
              setForm((f) => ({ ...f, templateName: e.target.value }))
            }
          >
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
            onChange={(e) =>
              setForm((f) => ({ ...f, excludeOptOut: e.target.checked }))
            }
          />
          <span>Excluir contatos em Opt-out (recomendado)</span>
        </div>

        <div className="cmp-actions">
          <button className="cmp-btn cmp-btn-primary" onClick={onNext}>
            Prosseguir
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
