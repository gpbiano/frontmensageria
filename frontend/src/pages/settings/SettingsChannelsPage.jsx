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
            style={{
              all: "unset",
              cursor: "pointer",
              width: 34,
              height: 34,
              display: "grid",
              placeItems: "center",
              borderRadius: 10
            }}
            title="Fechar"
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

function fieldStyle() {
  return {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,.10)",
    background: "rgba(255,255,255,.04)",
    color: "#e5e7eb",
    outline: "none"
  };
}

function labelStyle() {
  return { fontSize: 12, opacity: 0.85, marginBottom: 6 };
}

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

  const [webchatOpen, setWebchatOpen] = useState(false);
  const [webchatDraft, setWebchatDraft] = useState(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

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

    // compat: alguns lugares usavam "title", outros "headerTitle"
    const headerTitle = cfg.headerTitle || cfg.title || "Atendimento";
    const buttonText = cfg.buttonText || "Ajuda";
    const greeting = cfg.greeting || "Olá! Como posso ajudar?";
    const position = cfg.position === "left" ? "left" : "right";

    const primaryColor = cfg.primaryColor || cfg.color || "#34d399";

    setWebchatDraft({
      enabled: !!ch.enabled,
      widgetKey: ch.widgetKey || "",
      allowedOrigins: Array.isArray(ch.allowedOrigins) ? ch.allowedOrigins : [],
      config: {
        primaryColor,
        position,
        buttonText,
        headerTitle,
        greeting
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
      const scriptTag = res?.scriptTag || res?.snippet || "";
      setSnippet(scriptTag);
      setSnippetMeta(res || null);
    } catch (e) {
      setSnippet("");
      setSnippetMeta(null);
    } finally {
      setSnippetLoading(false);
    }
  }

  useEffect(() => {
    if (webchatOpen) loadSnippet();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webchatOpen]);

  async function saveWebchat() {
    if (!webchatDraft) return;

    setSaving(true);
    setError("");

    try {
      const cfg = webchatDraft.config || {};

      const primaryColor = (cfg.primaryColor || "#34d399").trim();

      const payload = {
        enabled: !!webchatDraft.enabled,
        allowedOrigins: Array.isArray(webchatDraft.allowedOrigins)
          ? webchatDraft.allowedOrigins
          : [],
        // ✅ backend: config primaryColor + color (compat)
        config: {
          primaryColor,
          color: primaryColor,
          position: cfg.position === "left" ? "left" : "right",
          buttonText: String(cfg.buttonText || "Ajuda"),
          headerTitle: String(cfg.headerTitle || "Atendimento"),
          title: String(cfg.headerTitle || "Atendimento"), // compat p/ lugares antigos
          greeting: String(cfg.greeting || "Olá! Como posso ajudar?")
        }
      };

      await updateWebchatChannel(payload);
      await loadChannels();
      await loadSnippet();

      setToast("Configuração salva com sucesso.");
      setTimeout(() => setToast(""), 2000);
    } catch (e) {
      setError(e?.message || String(e));
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
    setError("");

    try {
      const res = await rotateWebchatKey();
      const newKey = res?.widgetKey || "";

      setWebchatDraft((p) => (p ? { ...p, widgetKey: newKey } : p));

      await loadChannels();
      await loadSnippet();

      setToast("Chave atualizada.");
      setTimeout(() => setToast(""), 2000);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setToast("Copiado!");
      setTimeout(() => setToast(""), 1200);
    } catch {
      // sem fallback
    }
  }

  const webchatStatusVariant = webchat?.enabled ? "on" : "off";
  const whatsappVariant = whatsapp?.enabled ? "on" : "off";

  // ✅ EMBED COMPLETO: inclui data-* que o widget usa para personalização
  function embedFallbackFromDraft() {
    const widgetKey = webchatDraft?.widgetKey || webchat?.widgetKey || "wkey_xxx";

    const apiBase = isDev
      ? import.meta.env.VITE_API_BASE ||
        import.meta.env.VITE_API_BASE_URL ||
        "http://localhost:3010"
      : "https://api.gplabs.com.br";

    const cfg = webchatDraft?.config || {};
    const color = (cfg.primaryColor || "#34d399").trim();
    const position = cfg.position === "left" ? "left" : "right";
    const buttonText = String(cfg.buttonText || "Ajuda").replace(/"/g, "&quot;");
    const title = String(cfg.headerTitle || "Atendimento").replace(/"/g, "&quot;");
    const greeting = String(cfg.greeting || "Olá! Como posso ajudar?").replace(
      /"/g,
      "&quot;"
    );

    return `<script
  src="https://widget.gplabs.com.br/widget.js"
  data-widget-key="${widgetKey}"
  data-api-base="${apiBase}"
  data-color="${color}"
  data-position="${position}"
  data-button-text="${buttonText}"
  data-title="${title}"
  data-greeting="${greeting}"
  async
></script>`;
  }

  const embedSnippet = snippet || embedFallbackFromDraft();

  return (
    <div className="settings-page">
      <h1 className="settings-title">Configurações</h1>
      <p className="settings-subtitle">
        Defina os canais que irão se conectar à sua Plataforma WhatsApp GP Labs.
      </p>

      <div className="settings-env-info">
        <span>{isDev ? "Ambiente local" : "Produção"}</span>
      </div>

      {!!toast && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(52, 211, 153, .35)",
            background: "rgba(52, 211, 153, .10)",
            color: "#d1fae5"
          }}
        >
          {toast}
        </div>
      )}

      {!!error && (
        <div
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(248,113,113,.35)",
            background: "rgba(248,113,113,.10)",
            color: "#fecaca"
          }}
        >
          {error}
        </div>
      )}

      <section className="settings-section">
        <h2 className="settings-section-title">Canais de atendimento</h2>
        <p className="settings-section-description">
          Selecione um canal para ver os detalhes e configurar.
        </p>

        <div className="settings-channels-grid">
          {/* Web Chat */}
          <div
            className="settings-channel-card"
            style={{ cursor: "pointer" }}
            onClick={openWebchatConfig}
            title="Configurar Web Chat"
          >
            <div className="settings-channel-header">
              <span className="settings-channel-title">
                Janela Web (Web Chat)
              </span>
              <Pill variant={webchatStatusVariant}>
                {webchat?.enabled ? "Ativo" : "Desativado"}
              </Pill>
            </div>

            <p className="settings-channel-description">
              Atendimento via chat integrado ao seu site.
            </p>

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="settings-primary-btn" disabled={saving}>
                Configurar
              </button>
            </div>
          </div>

          {/* WhatsApp */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">WhatsApp</span>
              <Pill variant={whatsappVariant}>
                {whatsappVariant === "on" ? "Ativo" : "Desativado"}
              </Pill>
            </div>
            <p className="settings-channel-description">
              Mensagens pela API oficial do WhatsApp Business.
            </p>
          </div>

          {/* Messenger */}
          <div className="settings-channel-card" style={{ opacity: 0.8 }}>
            <div className="settings-channel-header">
              <span className="settings-channel-title">Messenger</span>
              <Pill variant="soon">Em breve</Pill>
            </div>
            <p className="settings-channel-description">
              Integração com a caixa de mensagens da sua página do Facebook.
            </p>
          </div>

          {/* Instagram */}
          <div className="settings-channel-card" style={{ opacity: 0.8 }}>
            <div className="settings-channel-header">
              <span className="settings-channel-title">Instagram</span>
              <Pill variant="soon">Em breve</Pill>
            </div>
            <p className="settings-channel-description">
              Mensagens diretas (DM) do Instagram integradas no painel de atendimento.
            </p>
          </div>
        </div>

        <div style={{ marginTop: 14, opacity: 0.9 }}>
          {loading ? (
            <span>Carregando canais...</span>
          ) : (
            <span>
              Canais carregados do backend.
              <button
                style={{
                  marginLeft: 10,
                  all: "unset",
                  cursor: "pointer",
                  textDecoration: "underline"
                }}
                onClick={loadChannels}
              >
                Recarregar
              </button>
            </span>
          )}
        </div>
      </section>

      <Modal
        open={webchatOpen}
        title="Configurar Janela Web (Web Chat)"
        onClose={() => setWebchatOpen(false)}
      >
        {!webchatDraft ? (
          <div>Carregando...</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {/* Linha 1 */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <div>
                <div style={labelStyle()}>Status do canal</div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!webchatDraft.enabled}
                    onChange={(e) =>
                      setWebchatDraft((p) => ({
                        ...p,
                        enabled: e.target.checked
                      }))
                    }
                  />
                  <span>{webchatDraft.enabled ? "Ativo" : "Desativado"}</span>
                </label>
                <div style={{ marginTop: 6, opacity: 0.75, fontSize: 12 }}>
                  Se desativado, o widget não inicia sessão no site.
                </div>
              </div>

              <div>
                <div style={labelStyle()}>Chave do widget (widgetKey)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={fieldStyle()} value={webchatDraft.widgetKey || ""} readOnly />
                  <button
                    className="settings-primary-btn"
                    onClick={() => copy(webchatDraft.widgetKey || "")}
                    disabled={!webchatDraft.widgetKey}
                  >
                    Copiar
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.95 }}
                    onClick={rotateKey}
                    disabled={saving}
                  >
                    Rotacionar chave
                  </button>
                </div>
              </div>
            </div>

            {/* Personalização */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <div>
                <div style={labelStyle()}>Cor principal</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.primaryColor || "#34d399"}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: {
                        ...(p.config || {}),
                        primaryColor: e.target.value
                      }
                    }))
                  }
                  placeholder="#34d399"
                />
              </div>

              <div>
                <div style={labelStyle()}>Posição do widget</div>
                <select
                  style={fieldStyle()}
                  value={webchatDraft.config?.position || "right"}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: { ...(p.config || {}), position: e.target.value }
                    }))
                  }
                >
                  <option value="right">Direita</option>
                  <option value="left">Esquerda</option>
                </select>
              </div>

              <div>
                <div style={labelStyle()}>Texto do botão</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.buttonText || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: { ...(p.config || {}), buttonText: e.target.value }
                    }))
                  }
                  placeholder="Ajuda"
                />
              </div>

              <div>
                <div style={labelStyle()}>Título do cabeçalho</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.headerTitle || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: { ...(p.config || {}), headerTitle: e.target.value }
                    }))
                  }
                  placeholder="Atendimento"
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <div style={labelStyle()}>Mensagem de boas-vindas</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.greeting || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: { ...(p.config || {}), greeting: e.target.value }
                    }))
                  }
                  placeholder="Olá! Como posso ajudar?"
                />
              </div>
            </div>

            {/* Allowed Origins */}
            <div>
              <div style={labelStyle()}>
                Origens permitidas (uma por linha)
              </div>
              <textarea
                style={{ ...fieldStyle(), minHeight: 110, resize: "vertical" }}
                value={(webchatDraft.allowedOrigins || []).join("\n")}
                onChange={(e) =>
                  setWebchatDraft((p) => ({
                    ...p,
                    allowedOrigins: normalizeOriginLines(e.target.value)
                  }))
                }
                placeholder={`Ex:\nhttps://cliente.gplabs.com.br\nhttps://www.gplabs.com.br`}
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                A origem precisa bater exatamente com o endereço do site (incluindo https://).
              </div>

              {isDev &&
                (!webchatDraft.allowedOrigins ||
                  webchatDraft.allowedOrigins.length === 0) && (
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.9 }}>
                    <button
                      className="settings-primary-btn"
                      style={{ opacity: 0.9 }}
                      onClick={() =>
                        setWebchatDraft((p) => ({
                          ...p,
                          allowedOrigins: [
                            "http://localhost:5173",
                            "http://127.0.0.1:5173"
                          ]
                        }))
                      }
                    >
                      Preencher origens de teste
                    </button>
                  </div>
                )}
            </div>

            {/* Snippet */}
            <div>
              <div style={labelStyle()}>
                Script de embed{" "}
                <span style={{ opacity: 0.75 }}>
                  (use este script no site para aplicar as personalizações)
                </span>
              </div>

              <textarea
                style={{
                  ...fieldStyle(),
                  minHeight: 120,
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12
                }}
                value={snippetLoading ? "Carregando..." : embedSnippet}
                readOnly
              />

              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="settings-primary-btn"
                  onClick={() => copy(embedSnippet)}
                >
                  Copiar embed
                </button>
                <button
                  className="settings-primary-btn"
                  style={{ opacity: 0.9 }}
                  onClick={() => copy(webchatDraft.widgetKey || "")}
                  disabled={!webchatDraft.widgetKey}
                >
                  Copiar widgetKey
                </button>
                <button
                  className="settings-primary-btn"
                  style={{ opacity: 0.9 }}
                  onClick={loadSnippet}
                  disabled={snippetLoading}
                >
                  {snippetLoading ? "Atualizando..." : "Atualizar script"}
                </button>
              </div>

              {!!snippetMeta?.allowedOrigins?.length && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  Origens salvas no backend:{" "}
                  <code>{(snippetMeta.allowedOrigins || []).join(", ")}</code>
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                className="settings-primary-btn"
                style={{ opacity: 0.85 }}
                onClick={() => setWebchatOpen(false)}
                disabled={saving}
              >
                Cancelar
              </button>
              <button
                className="settings-primary-btn"
                onClick={saveWebchat}
                disabled={saving}
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
