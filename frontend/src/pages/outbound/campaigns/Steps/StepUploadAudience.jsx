// frontend/src/pages/outbound/campaigns/steps/StepUploadAudience.jsx
import { useMemo, useRef, useState } from "react";

function extractVarIndexesFromTemplate(template) {
  const indexes = new Set();

  const components = template?.components || [];
  for (const c of components) {
    const txt = String(c?.text || "");
    const re = /{{\s*(\d+)\s*}}/g;
    let m;
    while ((m = re.exec(txt))) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > 0) indexes.add(n);
    }
  }

  return Array.from(indexes).sort((a, b) => a - b);
}

function buildAudienceHeaders(template) {
  const idxs = extractVarIndexesFromTemplate(template);

  // Se não detectar variáveis, mantém 2 colunas exemplo (como seu comportamento atual)
  const count = idxs.length ? Math.max(...idxs) : 2;

  const headers = ["numero"];
  for (let i = 1; i <= count; i++) headers.push(`body_var_${i}`);
  return headers;
}

function buildExampleRow(headers) {
  return headers.map((h) => {
    if (h === "numero") return "5599999999999";
    if (h === "body_var_1") return "João";
    if (h === "body_var_2") return "Promoção";
    return `${h}_exemplo`;
  });
}

export default function StepUploadAudience({
  campaignId,
  template, // ✅ NOVO: vem do wizard (template selecionado)
  onBack,
  onNext,
  loading = false
}) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);

  const headers = useMemo(() => buildAudienceHeaders(template), [template]);

  function downloadExample() {
    const row = buildExampleRow(headers);
    const csv = `${headers.join(",")}\n${row.join(",")}\n`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `exemplo_audiencia_${template?.name || "template"}.csv`;
    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="cmp-grid-1">
      <div
        className="cmp-card"
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center"
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Carregue corretamente seu público</h2>
          <div className="cmp-subtitle">
            Baixe um exemplo para seguir o padrão. Campanha:{" "}
            <span className="cmp-pill">{campaignId}</span>
          </div>

          <div className="cmp-subtitle" style={{ marginTop: 6, opacity: 0.85 }}>
            Colunas esperadas para o template: <strong>{headers.join(", ")}</strong>
          </div>
        </div>

        <button
          className="cmp-btn cmp-btn-primary"
          onClick={downloadExample}
          disabled={loading}
        >
          Baixar arquivo de exemplo
        </button>
      </div>

      <div className="cmp-card">
        <h2 style={{ margin: 0, fontSize: 16 }}>Upload do seu público</h2>
        <div className="cmp-subtitle" style={{ marginBottom: 10 }}>
          Envie um arquivo <strong>.csv</strong> com a coluna <strong>numero</strong> e variáveis{" "}
          <strong>body_var_*</strong> conforme o template.
        </div>

        <div
          className="cmp-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          role="button"
        >
          <div className="cmp-pill">
            <span className="cmp-ok">●</span> Clique para escolher ou arraste seu CSV aqui
          </div>
          <div className="cmp-hint">
            {file ? `Selecionado: ${file.name}` : "Nenhum arquivo selecionado"}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            disabled={loading}
          />
        </div>

        <div className="cmp-actions">
          <button className="cmp-btn" onClick={onBack} disabled={loading}>
            Retornar
          </button>
          <button
            className="cmp-btn cmp-btn-primary"
            onClick={() => onNext(file)}
            disabled={!file || loading}
          >
            {loading ? "Enviando…" : "Prosseguir"}
          </button>
        </div>
      </div>
    </div>
  );
}
