// frontend/src/pages/outbound/campaigns/steps/StepUploadAudience.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { mpTrack } from "../../../../lib/mixpanel";

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

function safeStr(v) {
  return String(v ?? "").trim();
}

function isCsvFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".csv") || String(file?.type || "").includes("csv");
}

export default function StepUploadAudience({
  campaignId,
  template, // ✅ vem do wizard (template selecionado)
  onBack,
  onNext,
  loading = false
}) {
  const inputRef = useRef(null);
  const trackedViewRef = useRef(false);

  const [file, setFile] = useState(null);
  const [localErr, setLocalErr] = useState("");

  const headers = useMemo(() => buildAudienceHeaders(template), [template]);
  const varsCount = useMemo(() => Math.max(0, headers.length - 1), [headers]);

  // track view (uma vez)
  useEffect(() => {
    if (trackedViewRef.current) return;
    trackedViewRef.current = true;

    mpTrack("campaign_wizard_audience_step_view", {
      campaign_id: campaignId ?? null,
      template_name: safeStr(template?.name) || "",
      template_category: safeStr(template?.category) || "",
      template_vars_count: varsCount
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPickedFile(f) {
    setLocalErr("");
    setFile(f || null);

    if (f) {
      mpTrack("campaign_audience_file_selected", {
        campaign_id: campaignId ?? null,
        file_name: String(f.name || ""),
        file_size: Number(f.size || 0),
        template_vars_count: varsCount
      });
    }
  }

  function downloadExample() {
    const row = buildExampleRow(headers);
    const csv = `${headers.join(",")}\n${row.join(",")}\n`;

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `exemplo_audiencia_${template?.name || "template"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 300);

    mpTrack("campaign_audience_example_downloaded", {
      campaign_id: campaignId ?? null,
      template_name: safeStr(template?.name) || "",
      template_vars_count: varsCount
    });
  }

  function handleBack() {
    mpTrack("campaign_wizard_back_clicked", {
      step: "audience",
      campaign_id: campaignId ?? null
    });
    onBack?.();
  }

  async function handleNext() {
    setLocalErr("");

    if (!file) {
      const msg = "Selecione um arquivo CSV para prosseguir.";
      setLocalErr(msg);
      mpTrack("campaign_audience_upload_blocked", {
        campaign_id: campaignId ?? null,
        reason: msg
      });
      return;
    }

    if (!isCsvFile(file)) {
      const msg = "O arquivo precisa ser .csv";
      setLocalErr(msg);
      mpTrack("campaign_audience_upload_blocked", {
        campaign_id: campaignId ?? null,
        reason: msg,
        file_name: String(file?.name || "")
      });
      return;
    }

    mpTrack("campaign_audience_upload_clicked", {
      campaign_id: campaignId ?? null,
      file_name: String(file?.name || ""),
      file_size: Number(file?.size || 0),
      template_vars_count: varsCount
    });

    try {
      // o wizard já trata o upload e vai pro próximo step
      await onNext?.(file);

      mpTrack("campaign_audience_upload_success", {
        campaign_id: campaignId ?? null,
        file_name: String(file?.name || ""),
        file_size: Number(file?.size || 0)
      });
    } catch (e) {
      const msg = safeStr(e?.message) || "Erro ao enviar audiência.";
      setLocalErr(msg);

      mpTrack("campaign_audience_upload_error", {
        campaign_id: campaignId ?? null,
        error: msg,
        file_name: String(file?.name || "")
      });
    }
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

        {!!localErr && (
          <div className="cmp-pill" style={{ borderColor: "rgba(239,68,68,0.35)" }}>
            <span className="cmp-err">●</span> {localErr}
          </div>
        )}

        <div
          className="cmp-dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setPickedFile(f);
          }}
          role="button"
          aria-label="Selecionar CSV de audiência"
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
            onChange={(e) => setPickedFile(e.target.files?.[0] || null)}
            disabled={loading}
          />
        </div>

        <div className="cmp-actions">
          <button className="cmp-btn" onClick={handleBack} disabled={loading}>
            Retornar
          </button>

          <button
            className="cmp-btn cmp-btn-primary"
            onClick={handleNext}
            disabled={!file || loading}
          >
            {loading ? "Enviando…" : "Prosseguir"}
          </button>
        </div>
      </div>
    </div>
  );
}
