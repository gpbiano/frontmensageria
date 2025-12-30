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

// =========================
// Helpers: Template CSV
// =========================
function filenameSafe(s) {
  return String(s || "")
    .trim()
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

/**
 * Extrai variáveis do template:
 * - {{1}} => var_1
 * - {{2}} => var_2
 * - {{var_1}} => var_1
 * - {{nome}} => nome
 * - ignora placeholders vazios
 */
function extractTemplateVars(message) {
  const text = String(message || "");
  const re = /{{\s*([^}]+?)\s*}}/g;

  const out = new Set();

  let m;
  while ((m = re.exec(text)) !== null) {
    const raw = String(m[1] || "").trim();
    if (!raw) continue;

    // se for número puro: {{1}} -> var_1
    if (/^\d+$/.test(raw)) {
      out.add(`var_${raw}`);
      continue;
    }

    // se já vier var_1, var_2...
    if (/^var_\d+$/i.test(raw)) {
      out.add(raw.toLowerCase());
      continue;
    }

    // qualquer outro nome: {{nome}} => nome
    out.add(raw);
  }

  // ordena: var_1, var_2... primeiro; depois alfabético
  const arr = Array.from(out);

  const varOnes = arr
    .filter((k) => /^var_\d+$/i.test(k))
    .sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1]));

  const others = arr
    .filter((k) => !/^var_\d+$/i.test(k))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  return [...varOnes, ...others];
}

function buildCsvTemplate({ message, delimiter = ";" }) {
  const vars = extractTemplateVars(message);
  const headers = ["numero", ...vars];

  // monta 2 linhas exemplo
  const row1 = ["5511999999999"];
  const row2 = ["5511988887777"];

  for (const v of vars) {
    // valores exemplo diferentes por linha
    if (/^var_\d+$/i.test(v)) {
      const n = v.split("_")[1];
      row1.push(`Exemplo_${n}_A`);
      row2.push(`Exemplo_${n}_B`);
    } else {
      row1.push(`Exemplo_${v}_A`);
      row2.push(`Exemplo_${v}_B`);
    }
  }

  const lines = [
    headers.join(delimiter),
    row1.join(delimiter),
    row2.join(delimiter)
  ];

  return { csvText: lines.join("\n"), headers, vars };
}

function downloadTextFile({ content, filename, mime = "text/csv;charset=utf-8" }) {
  const blob = new Blob([content], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function SmsCampaignCreateWizard({ onExit }) {
  const [stepIndex, setStepIndex] = useState(0);

  const [campaign, setCampaign] = useState(null);
  const [name, setName] = useState("Campanha SMS");
  const [message, setMessage] = useState(
    "Olá! Aqui é a GP Labs 🙂\nQuer conhecer nossos serviços?"
  );
  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  const step = useMemo(() => STEPS[stepIndex], [stepIndex]);

  const EXAMPLE_TEXT = "{{1}}";
  const EXAMPLE_VAR = "{{var_1}}";

  const charCount = message?.length || 0;
  const smsParts = charCount <= 160 ? 1 : Math.ceil(charCount / 153);
  const charsLimit = smsParts === 1 ? 160 : smsParts * 153;

  const detectedVars = useMemo(() => extractTemplateVars(message), [message]);

  function next() {
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepIndex((s) => Math.max(s - 1, 0));
  }

  function handleDownloadTemplate() {
    setError("");
    setInfo("");

    const { csvText, headers, vars } = buildCsvTemplate({ message, delimiter: ";" });

    const fname = `modelo_audiencia_sms_${filenameSafe(name)}.csv`;
    downloadTextFile({ content: csvText, filename: fname });

    const humanVars = vars.length ? vars.join(", ") : "nenhuma";
    setInfo(`✅ Modelo baixado. Colunas: ${headers.join(" ; ")} • Variáveis detectadas: ${humanVars}`);
  }

  async function handleCreate() {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      const r = await createSmsCampaign({ name, message });
      setCampaign(r.item);
      setInfo("✅ Campanha criada com sucesso.");
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

      // backend pode retornar 'imported', 'audienceCount' etc — tentamos cobrir
      const count =
        r?.audienceCount ??
        r?.imported ??
        r?.item?.audience?.total ??
        r?.item?.audienceCount ??
        0;

      setInfo(`✅ Audiência importada: ${count} número(s).`);
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
        `🚀 Envio iniciado. Enviados: ${r.sent ?? 0} | Falhas: ${r.failed ?? 0} | Status: ${r.status ?? "ok"}`
      );
    } catch (e) {
      setError(e?.message || "Erro ao iniciar envio.");
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
        <div className="wizard-card" style={{ maxWidth: 820 }}>
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12
            }}
          >
            <div>
              <h3 style={{ marginBottom: 6 }}>Criar campanha</h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Defina o nome e a mensagem do SMS. Você pode personalizar com
                variáveis do CSV.
              </p>
            </div>

            <div className="wizard-actions" style={{ marginTop: 0, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={handleDownloadTemplate}
                disabled={busy}
                title="Baixa um CSV modelo com as colunas necessárias conforme as variáveis usadas na mensagem."
              >
                Baixar planilha exemplo
              </button>

              <button className="btn secondary" type="button" onClick={onExit} disabled={busy}>
                Cancelar
              </button>
              <button className="btn primary" type="button" onClick={handleCreate} disabled={busy}>
                {busy ? "Criando..." : "Criar"}
              </button>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14 }}>
            {/* FORM */}
            <div>
              <label className="field">
                <span>Nome</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                  placeholder="Ex: Black Friday • SMS"
                />
              </label>

              <label className="field">
                <span>Mensagem</span>
                <textarea
                  rows={6}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  disabled={busy}
                  placeholder="Digite a mensagem do SMS..."
                  style={{ resize: "vertical" }}
                />
                <div
                  className="muted"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 6
                  }}
                >
                  <span>
                    {charCount} caracteres • {smsParts} SMS
                  </span>
                  <span>Limite estimado: {charsLimit}</span>
                </div>
              </label>

              <div
                className="muted"
                style={{
                  marginTop: 10,
                  padding: 10,
                  border: "1px solid rgba(255,255,255,.08)",
                  borderRadius: 10,
                  background: "rgba(255,255,255,.03)"
                }}
              >
                Dica: personalize usando <b>{EXAMPLE_TEXT}</b> ou{" "}
                <b>{EXAMPLE_VAR}</b> e no CSV crie a coluna <b>var_1</b>.
                <div style={{ marginTop: 6, opacity: 0.9 }}>
                  Variáveis detectadas:{" "}
                  <b>{detectedVars.length ? detectedVars.join(", ") : "nenhuma"}</b>
                </div>
              </div>
            </div>

            {/* PREVIEW “PHONE” */}
            <div
              style={{
                border: "1px solid rgba(255,255,255,.10)",
                borderRadius: 14,
                padding: 12,
                background: "rgba(0,0,0,.25)"
              }}
            >
              <div
                className="muted"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10
                }}
              >
                <span>Prévia (SMS)</span>
                <span>{smsParts} parte(s)</span>
              </div>

              <div
                style={{
                  borderRadius: 14,
                  padding: 12,
                  background: "rgba(255,255,255,.04)",
                  border: "1px solid rgba(255,255,255,.06)",
                  minHeight: 160,
                  whiteSpace: "pre-wrap",
                  lineHeight: 1.35
                }}
              >
                {message || "Sua mensagem aparecerá aqui..."}
              </div>

              <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
                * Contagem é estimativa. Pode variar conforme acentos/Unicode.
              </div>
            </div>
          </div>
        </div>
      )}

      {step.key === "audience" && (
        <div className="wizard-card" style={{ maxWidth: 820 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
            <div>
              <h3>Carregar audiência (CSV)</h3>
              <p className="muted">
                Header obrigatório: <b>numero</b> (ou <b>phone</b>). Opcional:{" "}
                <b>var_1</b>, <b>var_2</b>...
              </p>
            </div>

            <div className="wizard-actions" style={{ marginTop: 0 }}>
              <button
                className="btn secondary"
                type="button"
                onClick={handleDownloadTemplate}
                disabled={busy}
                title="Baixa um CSV modelo com colunas compatíveis com a sua mensagem."
              >
                Baixar planilha exemplo
              </button>
            </div>
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)"
            }}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              disabled={busy}
            />

            <div style={{ marginTop: 10 }}>
              <p className="muted" style={{ marginBottom: 6 }}>
                Exemplo CSV (com ; ou ,):
              </p>

              {/* exemplo dinâmico conforme variáveis */}
              <pre className="code">
{(() => {
  const { csvText } = buildCsvTemplate({ message, delimiter: ";" });
  return csvText;
})()}
              </pre>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={back} disabled={busy}>
              Voltar
            </button>
            <button className="btn primary" type="button" onClick={handleUpload} disabled={busy}>
              {busy ? "Importando..." : "Importar"}
            </button>
          </div>
        </div>
      )}

      {step.key === "start" && (
        <div className="wizard-card" style={{ maxWidth: 820 }}>
          <h3>Iniciar envio</h3>

          <p className="muted">
            O envio roda em fila com throttle e retry automático. Você pode
            acompanhar o progresso no Relatório.
          </p>

          <div
            style={{
              padding: 12,
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,.10)",
              background: "rgba(255,255,255,.03)"
            }}
          >
            <div className="muted" style={{ marginBottom: 8 }}>
              Campanha: <b>{campaign?.name || "-"}</b>
            </div>
            <div className="muted">
              Mensagem:{" "}
              <span style={{ opacity: 0.9 }}>
                {(campaign?.message || campaign?.metadata?.message || message || "").slice(0, 120)}
                {(campaign?.message || campaign?.metadata?.message || message || "").length > 120 ? "..." : ""}
              </span>
            </div>
          </div>

          <div className="wizard-actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={back} disabled={busy}>
              Voltar
            </button>
            <button className="btn primary" type="button" onClick={handleStart} disabled={busy}>
              {busy ? "Enviando..." : "Iniciar"}
            </button>
            <button className="btn ghost" type="button" onClick={onExit} disabled={busy}>
              Finalizar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
