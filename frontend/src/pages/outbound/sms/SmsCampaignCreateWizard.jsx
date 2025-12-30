// frontend/src/pages/outbound/sms/SmsCampaignCreateWizard.jsx
import { useEffect, useMemo, useState } from "react";
import {
  createSmsCampaign,
  uploadSmsCampaignAudience,
  startSmsCampaign
} from "../../../api";
import "../../../styles/campaigns.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_KEY = "gpLabsAuthToken";
function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_KEY);
}

const STEPS = [
  { key: "create", label: "1. Criar campanha" },
  { key: "audience", label: "2. Carregar audiência" },
  { key: "start", label: "3. Iniciar campanha" }
];

function statusLabel(s) {
  const v = String(s || "").toLowerCase();
  if (v === "draft") return "Rascunho";
  if (v === "running") return "Enviando";
  if (v === "paused") return "Pausada";
  if (v === "canceled") return "Cancelada";
  if (v === "finished") return "Finalizada";
  if (v === "failed") return "Falhou";
  return v || "-";
}

function safeMessageFromCampaign(c, fallback = "") {
  if (!c) return fallback;
  // Alguns schemas guardam no metadata.message (como seu backend atual)
  return (
    c.message ||
    c?.metadata?.message ||
    c?.metadata?.smsMessage ||
    fallback
  );
}

function safeAudienceCount(c) {
  if (!c) return 0;
  if (Number.isFinite(Number(c.audienceCount))) return Number(c.audienceCount);
  if (Number.isFinite(Number(c?.audience?.total))) return Number(c.audience.total);
  if (Array.isArray(c?.audience?.rows)) return c.audience.rows.length;
  return 0;
}

async function callCampaignAction(campaignId, action) {
  const token = getToken();
  if (!token) throw new Error("Você não está autenticado. Faça login novamente.");

  // action: "pause" | "resume" | "cancel"
  const url = `${API_BASE}/outbound/sms-campaigns/${campaignId}/${action}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  // tenta retornar erro humano
  if (!res.ok) {
    let msg = `Falha (HTTP ${res.status}).`;
    try {
      const t = await res.text();
      if (t) msg = t;
    } catch {}
    throw new Error(String(msg));
  }

  // pode ser json ou vazio
  try {
    return await res.json();
  } catch {
    return { ok: true };
  }
}

export default function SmsCampaignCreateWizard({
  onExit,
  mode = "create", // "create" | "edit"
  initialCampaign = null
}) {
  const [stepIndex, setStepIndex] = useState(0);

  const [campaign, setCampaign] = useState(null);

  // defaults
  const [name, setName] = useState("Campanha SMS");
  const [message, setMessage] = useState(
    "Olá! Aqui é a GP Labs 🙂\nQuer conhecer nossos serviços?"
  );

  const [file, setFile] = useState(null);

  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [error, setError] = useState("");

  // ✅ Ao editar: preenche campos e já seta campaign
  useEffect(() => {
    if (mode === "edit" && initialCampaign?.id) {
      setCampaign(initialCampaign);
      setName(String(initialCampaign?.name || "Campanha SMS"));
      setMessage(safeMessageFromCampaign(initialCampaign, message));
      // começa no passo 1 (permitir ajustar nome/mensagem antes)
      setStepIndex(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, initialCampaign?.id]);

  const step = useMemo(() => STEPS[stepIndex], [stepIndex]);

  const EXAMPLE_TEXT = "{{1}}";
  const EXAMPLE_VAR = "{{var_1}}";

  const charCount = message?.length || 0;
  const smsParts = charCount <= 160 ? 1 : Math.ceil(charCount / 153); // concatenado comum
  const charsLimit = smsParts === 1 ? 160 : smsParts * 153;

  const audienceCount = useMemo(() => safeAudienceCount(campaign), [campaign]);

  function next() {
    setStepIndex((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepIndex((s) => Math.max(s - 1, 0));
  }

  async function handleCreateOrSave() {
    setBusy(true);
    setError("");
    setInfo("");

    try {
      // ✅ Sem endpoint de update no backend ainda:
      // - No modo edit, "Salvar" mantém o fluxo (apenas ajusta localmente)
      // - Se quiser persistir update de nome/mensagem, eu implemento depois:
      //   PATCH /outbound/sms-campaigns/:id  (no backend) + função no api.js
      if (mode === "edit" && campaign?.id) {
        // Atualiza localmente pra refletir no passo 3
        setCampaign((prev) => ({
          ...(prev || {}),
          name,
          // alguns schemas não têm message, então guardamos também em metadata
          message,
          metadata: { ...(prev?.metadata || {}), message }
        }));
        setInfo("✅ Alterações aplicadas. (Persistência no backend será habilitada assim que o endpoint de update existir.)");
        next();
        return;
      }

      // create
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

      // compat: backend pode retornar audienceSummary / audienceCount / total…
      const imported =
        r?.audienceCount ??
        r?.audienceSummary?.total ??
        r?.item?.audience?.total ??
        r?.item?.audienceCount ??
        0;

      setInfo(`✅ Audiência importada: ${imported} números.`);

      // atualiza campaign local (se vier item)
      if (r?.item) setCampaign(r.item);
      else {
        // fallback: marca que agora tem audiência
        setCampaign((prev) => ({
          ...(prev || {}),
          audienceCount: imported
        }));
      }

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
        `🚀 Envio iniciado. Enviados: ${r.sent ?? 0} | Falhas: ${r.failed ?? 0} | Status: ${statusLabel(r.status)}`
      );

      // se o backend retornar status, atualiza local
      setCampaign((prev) => ({
        ...(prev || {}),
        status: r?.status || prev?.status || "running"
      }));
    } catch (e) {
      setError(e?.message || "Erro ao iniciar envio.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!campaign?.id) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await callCampaignAction(campaign.id, "pause");
      setInfo("⏸️ Campanha pausada.");
      setCampaign((prev) => ({ ...(prev || {}), status: r?.status || "paused" }));
    } catch (e) {
      setError(e?.message || "Erro ao pausar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResume() {
    if (!campaign?.id) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await callCampaignAction(campaign.id, "resume");
      setInfo("▶️ Campanha retomada.");
      setCampaign((prev) => ({ ...(prev || {}), status: r?.status || "running" }));
    } catch (e) {
      setError(e?.message || "Erro ao retomar campanha.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancel() {
    if (!campaign?.id) return;
    setBusy(true);
    setError("");
    setInfo("");
    try {
      const r = await callCampaignAction(campaign.id, "cancel");
      setInfo("🛑 Campanha cancelada.");
      setCampaign((prev) => ({ ...(prev || {}), status: r?.status || "canceled" }));
    } catch (e) {
      setError(e?.message || "Erro ao cancelar campanha.");
    } finally {
      setBusy(false);
    }
  }

  const campaignStatus = String(campaign?.status || "draft").toLowerCase();
  const canStart = !!campaign?.id && (audienceCount > 0);

  return (
    <div className="campaign-wizard">
      <div className="wizard-steps">
        {STEPS.map((s, idx) => (
          <div
            key={s.key}
            className={`wizard-step ${idx === stepIndex ? "active" : ""} ${idx < stepIndex ? "done" : ""}`}
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
              <h3 style={{ marginBottom: 6 }}>
                {mode === "edit" ? "Editar campanha" : "Criar campanha"}
              </h3>
              <p className="muted" style={{ marginTop: 0 }}>
                Defina o nome e a mensagem do SMS. Você pode personalizar com variáveis do CSV.
              </p>
              {campaign?.id && (
                <p className="muted" style={{ marginTop: 6, fontSize: 13 }}>
                  ID: <b>{String(campaign.id).slice(0, 12)}</b> • Status:{" "}
                  <b>{statusLabel(campaignStatus)}</b>
                </p>
              )}
            </div>

            <div className="wizard-actions" style={{ marginTop: 0 }}>
              <button className="btn secondary" type="button" onClick={onExit} disabled={busy}>
                Cancelar
              </button>

              <button
                className="btn primary"
                type="button"
                onClick={handleCreateOrSave}
                disabled={busy}
              >
                {busy
                  ? mode === "edit"
                    ? "Salvando..."
                    : "Criando..."
                  : mode === "edit"
                    ? "Salvar"
                    : "Criar"}
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
                Dica: personalize usando <b>{EXAMPLE_TEXT}</b> ou <b>{EXAMPLE_VAR}</b> e no CSV crie a coluna <b>var_1</b>.
              </div>
            </div>

            {/* PREVIEW */}
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

              {campaign?.id ? (
                <div className="muted" style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                  Audiência atual: <b>{audienceCount}</b>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {step.key === "audience" && (
        <div className="wizard-card" style={{ maxWidth: 820 }}>
          <h3>Carregar audiência (CSV)</h3>

          <p className="muted">
            Header obrigatório: <b>numero</b> (ou <b>phone</b>). Opcional: <b>var_1</b>, <b>var_2</b>...
          </p>

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
              <pre className="code">{`numero;var_1
5511999999999;João
5511988887777;Maria`}</pre>
            </div>

            {campaign?.id ? (
              <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                Campanha: <b>{campaign?.name || "-"}</b> • Audiência atual: <b>{audienceCount}</b>
              </div>
            ) : null}
          </div>

          <div className="wizard-actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={back} disabled={busy}>
              Voltar
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={handleUpload}
              disabled={busy || !campaign?.id}
              title={!campaign?.id ? "Crie/salve a campanha antes." : ""}
            >
              {busy ? "Importando..." : "Importar"}
            </button>

            <button
              className="btn ghost"
              type="button"
              onClick={next}
              disabled={busy || !campaign?.id}
              title={!campaign?.id ? "Crie/salve a campanha antes." : ""}
            >
              Pular
            </button>
          </div>
        </div>
      )}

      {step.key === "start" && (
        <div className="wizard-card" style={{ maxWidth: 820 }}>
          <h3>Iniciar envio</h3>

          <p className="muted">
            O envio roda em fila com throttle e retry automático. Você pode acompanhar o progresso no Relatório.
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
              Campanha: <b>{campaign?.name || name || "-"}</b>
            </div>

            <div className="muted" style={{ marginBottom: 8 }}>
              Status: <b>{statusLabel(campaignStatus)}</b> • Audiência: <b>{audienceCount}</b>
            </div>

            <div className="muted">
              Mensagem:{" "}
              <span style={{ opacity: 0.9 }}>
                {(safeMessageFromCampaign(campaign, message) || "").slice(0, 120)}
                {(safeMessageFromCampaign(campaign, message) || "").length > 120 ? "..." : ""}
              </span>
            </div>
          </div>

          {!canStart ? (
            <div className="alert" style={{ marginTop: 12 }}>
              Para iniciar, é necessário ter <b>audiência importada</b>. Volte e carregue um CSV.
            </div>
          ) : null}

          <div className="wizard-actions" style={{ marginTop: 12 }}>
            <button className="btn secondary" type="button" onClick={back} disabled={busy}>
              Voltar
            </button>

            <button
              className="btn primary"
              type="button"
              onClick={handleStart}
              disabled={busy || !canStart || campaignStatus === "running"}
              title={!canStart ? "Importe audiência antes de iniciar." : ""}
            >
              {busy ? "Iniciando..." : campaignStatus === "running" ? "Em envio..." : "Iniciar"}
            </button>

            {/* ✅ Controles (quando backend existir) */}
            <button
              className="btn secondary"
              type="button"
              onClick={handlePause}
              disabled={busy || !campaign?.id || campaignStatus !== "running"}
              title={campaignStatus !== "running" ? "Disponível apenas durante o envio." : ""}
            >
              Pausar
            </button>

            <button
              className="btn secondary"
              type="button"
              onClick={handleResume}
              disabled={busy || !campaign?.id || campaignStatus !== "paused"}
              title={campaignStatus !== "paused" ? "Disponível apenas quando pausada." : ""}
            >
              Retomar
            </button>

            <button
              className="btn secondary"
              type="button"
              onClick={handleCancel}
              disabled={busy || !campaign?.id || ["canceled", "finished"].includes(campaignStatus)}
              title={["canceled", "finished"].includes(campaignStatus) ? "Campanha já encerrada." : ""}
            >
              Cancelar
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
