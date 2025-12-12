import { useRef, useState } from "react";

export default function StepUploadAudience({ campaignId, onBack, onNext }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);

  function downloadExample() {
    const csv = "numero,body_var_1,body_var_2\n5599999999999,João,Promoção\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "exemplo_audiencia.csv";
    a.click();

    URL.revokeObjectURL(url);
  }

  return (
    <div className="cmp-grid-1">
      <div className="cmp-card" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 16 }}>Carregue corretamente seu público</h2>
          <div className="cmp-subtitle">
            Baixe um exemplo para seguir o padrão. Campanha: <span className="cmp-pill">{campaignId}</span>
          </div>
        </div>
        <button className="cmp-btn cmp-btn-primary" onClick={downloadExample}>
          Baixar arquivo de exemplo
        </button>
      </div>

      <div className="cmp-card">
        <h2 style={{ margin: 0, fontSize: 16 }}>Upload do seu público</h2>
        <div className="cmp-subtitle" style={{ marginBottom: 10 }}>
          Envie um arquivo <strong>.csv</strong> com a coluna <strong>numero</strong> e variáveis opcionais.
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
          />
        </div>

        <div className="cmp-actions">
          <button className="cmp-btn" onClick={onBack}>Retornar</button>
          <button
            className="cmp-btn cmp-btn-primary"
            onClick={() => onNext(file)}
            disabled={!file}
          >
            Prosseguir
          </button>
        </div>
      </div>
    </div>
  );
}
