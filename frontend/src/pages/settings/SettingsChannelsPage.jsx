// frontend/src/settings/SettingsChannelsPage.jsx
import { useEffect, useMemo, useState } from "react";

import {
  fetchChannels,
  updateWebchatChannel,
  rotateWebchatKey,
  fetchWebchatSnippet
} from "../../api";

/**
 * Configurações > Canais
 *
 * Backend:
 * - GET    /settings/channels
 * - PATCH  /settings/channels/webchat
 * - POST   /settings/channels/webchat/rotate-key
 * - GET    /settings/channels/webchat/snippet
 */

function Pill({ variant, children }) {
  const cls =
    variant === "on"
      ? "status-pill status-pill-on"
      : variant === "off"
      ? "status-pill status-pill-off"
      : "status-pill status-pill-soon";
  return <span className={cls}>{children}</span>;
}

function Modal({ open, title, children, onClose }) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 16
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        style={{
          width: "min(920px, 100%)",
          borderRadius: 16,
          background: "#0b1220",
          color: "#e5e7eb",
          border: "1px solid rgba(255,255,255,.10)",
          boxShadow: "0 30px 90px rgba(0,0,0,.55)",
          overflow: "hidden"
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(255,255,255,.08)",
            background: "rgba(255,255,255,.03)"
          }}
        >
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            title="Fechar"
            style={{
              all: "unset",
              cursor: "pointer",
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              borderRadius: 10
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

const fieldStyle = () => ({
  width: "100%",
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,.10)",
  background: "rgba(255,255,255,.04)",
  color: "#e5e7eb",
  outline: "none"
});

const labelStyle = () => ({
  fontSize: 12,
  opacity: 0.85,
  marginBottom: 6
});

function normalizeOriginLines(text) {
  return String(text || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((o) => o.replace(/\/+$/, ""));
}

export default function SettingsChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [channelsState, setChannelsState] = useState(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [webchatOpen, setWebchatOpen] = useState(false);
  const [webchatDraft, setWebchatDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [snippetMeta, setSnippetMeta] = useState(null);

  const isDev = useMemo(() => {
    try {
      return (
        window.location.hostname === "localhost" ||
        window.location.hostname === "127.0.0.1"
      );
    } catch {
      return false;
    }
  }, []);

  const webchat = channelsState?.webchat || null;
  const whatsapp = channelsState?.whatsapp || null;

  async function loadChannels() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchChannels();
      setChannelsState(data || {});
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
  }, []);

  function openWebchatConfig() {
    const ch = webchat || {};
    const cfg = ch?.config || {};

    const primaryColor = cfg.primaryColor || "#34d399";

    setWebchatDraft({
      enabled: !!ch.enabled,
      widgetKey: ch.widgetKey || "",
      allowedOrigins: Array.isArray(ch.allowedOrigins) ? ch.allowedOrigins : [],
      config: {
        primaryColor,
        position: cfg.position === "left" ? "left" : "right",
        buttonText: cfg.buttonText || "Ajuda",
        headerTitle: cfg.headerTitle || "Atendimento",
        greeting: cfg.greeting || "Olá! Como posso ajudar?"
      }
    });

    setSnippet("");
    setSnippetMeta(null);
    setWebchatOpen(true);
  }

  async function loadSnippet() {
    setSnippetLoading(true);
    try {
      const res = await fetchWebchatSnippet();
      setSnippet(res?.scriptTag || res?.snippet || "");
      setSnippetMeta(res || null);
    } catch {
      setSnippet("");
      setSnippetMeta(null);
    } finally {
      setSnippetLoading(false);
    }
  }

  useEffect(() => {
    if (webchatOpen) loadSnippet();
  }, [webchatOpen]);

  async function saveWebchat() {
    if (!webchatDraft) return;

    setSaving(true);
    setError("");

    try {
      const payload = {
        enabled: !!webchatDraft.enabled,
        allowedOrigins: webchatDraft.allowedOrigins || [],
        config: {
          primaryColor: webchatDraft.config.primaryColor,
          position: webchatDraft.config.position,
          buttonText: webchatDraft.config.buttonText,
          headerTitle: webchatDraft.config.headerTitle,
          greeting: webchatDraft.config.greeting
        }
      };

      await updateWebchatChannel(payload);
      await loadChannels();
      await loadSnippet();

      setToast("Configuração salva com sucesso.");
      setTimeout(() => setToast(""), 2000);
    } catch (e) {
      setError(e?.message || "Não foi possível salvar a configuração.");
    } finally {
      setSaving(false);
    }
  }

  async function rotateKey() {
    const ok = confirm(
      "Ao rotacionar a chave, scripts antigos deixarão de funcionar. Deseja continuar?"
    );
    if (!ok) return;

    setSaving(true);
    try {
      const res = await rotateWebchatKey();
      setWebchatDraft((p) => (p ? { ...p, widgetKey: res?.widgetKey } : p));
      await loadChannels();
      await loadSnippet();
      setToast("Chave atualizada.");
      setTimeout(() => setToast(""), 2000);
    } catch (e) {
      setError(e?.message || "Erro ao rotacionar a chave.");
    } finally {
      setSaving(false);
    }
  }

  async function copy(text) {
    await navigator.clipboard.writeText(String(text || ""));
    setToast("Copiado para a área de transferência.");
    setTimeout(() => setToast(""), 1200);
  }

  const webchatStatusVariant = webchat?.enabled ? "on" : "off";
  const whatsappVariant = whatsapp?.enabled ? "on" : "off";

  const embedSnippet =
    snippet ||
    `<script src="https://widget.gplabs.com.br/widget.js"
data-widget-key="${webchatDraft?.widgetKey || ""}"
data-api-base="https://api.gplabs.com.br"
async></script>`;

  return (
    <div className="settings-page">
      <h1 className="settings-title">Configurações</h1>
      <p className="settings-subtitle">
        Defina quais canais de atendimento estarão disponíveis para sua empresa.
      </p>

      {!!toast && <div className="settings-toast">{toast}</div>}
      {!!error && <div className="settings-error">{error}</div>}

      {/* Canais */}
      <section className="settings-section">
        <h2>Canais de atendimento</h2>

        <div className="settings-channels-grid">
          <div
            className="settings-channel-card"
            onClick={openWebchatConfig}
            style={{ cursor: "pointer" }}
          >
            <div className="settings-channel-header">
              <span>Janela Web (Web Chat)</span>
              <Pill variant={webchatStatusVariant}>
                {webchat?.enabled ? "Ativo" : "Desativado"}
              </Pill>
            </div>
            <p>Atendimento via chat integrado ao seu site.</p>
          </div>

          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span>WhatsApp</span>
              <Pill variant={whatsappVariant}>
                {whatsappVariant === "on" ? "Ativo" : "Desativado"}
              </Pill>
            </div>
            <p>Mensagens pela API oficial do WhatsApp Business.</p>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          {loading ? "Carregando canais..." : "Canais carregados com sucesso."}
          <button onClick={loadChannels} style={{ marginLeft: 10 }}>
            Recarregar
          </button>
        </div>
      </section>

      {/* Modal WebChat */}
      <Modal
        open={webchatOpen}
        title="Configurar Janela Web (Web Chat)"
        onClose={() => setWebchatOpen(false)}
      >
        {!webchatDraft ? (
          "Carregando..."
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            <label>
              <input
                type="checkbox"
                checked={webchatDraft.enabled}
                onChange={(e) =>
                  setWebchatDraft((p) => ({ ...p, enabled: e.target.checked }))
                }
              />{" "}
              Canal ativo
            </label>

            <div>
              <div style={labelStyle()}>widgetKey</div>
              <input style={fieldStyle()} value={webchatDraft.widgetKey} readOnly />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => copy(webchatDraft.widgetKey)}>
                  Copiar chave
                </button>
                <button onClick={rotateKey} disabled={saving}>
                  Rotacionar chave
                </button>
              </div>
            </div>

            <div>
              <div style={labelStyle()}>Allowed Origins</div>
              <textarea
                style={{ ...fieldStyle(), minHeight: 100 }}
                value={webchatDraft.allowedOrigins.join("\n")}
                onChange={(e) =>
                  setWebchatDraft((p) => ({
                    ...p,
                    allowedOrigins: normalizeOriginLines(e.target.value)
                  }))
                }
                placeholder={`https://cliente.gplabs.com.br\nhttps://www.gplabs.com.br`}
              />
            </div>

            <div>
              <div style={labelStyle()}>Script de embed</div>
              <textarea
                style={{ ...fieldStyle(), minHeight: 110 }}
                value={snippetLoading ? "Carregando..." : embedSnippet}
                readOnly
              />
              <button onClick={() => copy(embedSnippet)}>
                Copiar script
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setWebchatOpen(false)}>Cancelar</button>
              <button onClick={saveWebchat} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
