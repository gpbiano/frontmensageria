// frontend/src/settings/SettingsChannelsPage.jsx
import React, { useEffect, useMemo, useState } from "react";

/**
 * Settings > Canais
 * - Lista canais do backend: GET /settings/channels
 * - WebChat: criar, ativar/desativar, configurar, copiar embed e rotacionar widgetKey
 *
 * Backend esperado (já criamos):
 * - GET    /settings/channels
 * - POST   /settings/channels/webchat
 * - PATCH  /settings/channels/:id
 * - POST   /settings/channels/:id/rotate-widget-key
 */

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

function getToken() {
  try {
    return localStorage.getItem("gpLabsAuthToken");
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  const token = getToken();

  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    const msg = data?.error || data?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

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

export default function SettingsChannelsPage() {
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState([]);
  const [error, setError] = useState("");

  const [webchatOpen, setWebchatOpen] = useState(false);
  const [webchatDraft, setWebchatDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const isDev = useMemo(() => {
    try {
      return location.hostname === "localhost" || location.hostname === "127.0.0.1";
    } catch {
      return true;
    }
  }, []);

  const webchatChannel = useMemo(
    () => channels.find((c) => c?.type === "webchat") || null,
    [channels]
  );

  async function loadChannels() {
    setLoading(true);
    setError("");
    try {
      const data = await request("/settings/channels");
      setChannels(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
  }, []);

  function openWebchatConfig(ch) {
    if (!ch) return;
    setWebchatDraft(structuredClone(ch));
    setWebchatOpen(true);
  }

  async function ensureWebchatChannel() {
    setSaving(true);
    setError("");
    try {
      // se já existe, só abre
      if (webchatChannel) {
        openWebchatConfig(webchatChannel);
        return;
      }

      const data = await request("/settings/channels/webchat", {
        method: "POST",
        body: {
          name: "Web Chat",
          allowedOrigins: isDev
            ? ["http://localhost:5173", "http://127.0.0.1:5173"]
            : []
        }
      });

      const created = data?.item;
      if (created) {
        await loadChannels();
        openWebchatConfig(created);
        setToast("Canal Web Chat criado.");
        setTimeout(() => setToast(""), 2000);
      }
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveWebchat() {
    if (!webchatDraft?.id) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        active: !!webchatDraft.active,
        settings: {
          ...(webchatDraft.settings || {})
        },
        security: {
          ...(webchatDraft.security || {}),
          allowedOrigins: Array.isArray(webchatDraft.security?.allowedOrigins)
            ? webchatDraft.security.allowedOrigins
            : String(webchatDraft.security?.allowedOrigins || "")
                .split("\n")
                .map((s) => s.trim())
                .filter(Boolean)
        }
      };

      const data = await request(`/settings/channels/${webchatDraft.id}`, {
        method: "PATCH",
        body: payload
      });

      const updated = data?.item;
      if (updated) {
        setToast("Configuração salva.");
        setTimeout(() => setToast(""), 2000);
      }

      await loadChannels();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function rotateWidgetKey() {
    if (!webchatDraft?.id) return;
    const ok = confirm(
      "Rotacionar a widgetKey invalida os scripts antigos. Tem certeza?"
    );
    if (!ok) return;

    setSaving(true);
    setError("");
    try {
      const data = await request(
        `/settings/channels/${webchatDraft.id}/rotate-widget-key`,
        { method: "POST" }
      );
      const updated = data?.item;
      if (updated) {
        setWebchatDraft(updated);
        setToast("widgetKey rotacionada.");
        setTimeout(() => setToast(""), 2000);
      }
      await loadChannels();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  function getEmbedSnippet(ch) {
    const widgetKey = ch?.security?.widgetKey || "wkey_xxx";
    return `<script
  src="https://widget.gplabs.com.br/widget.js"
  data-widget-key="${widgetKey}"
  data-api-base="${API_BASE}"
  async
></script>`;
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copiado!");
      setTimeout(() => setToast(""), 1200);
    } catch {
      // fallback: nada
    }
  }

  const webchatStatus = webchatChannel
    ? webchatChannel.active
      ? "on"
      : "off"
    : "off";

  return (
    <div className="settings-page">
      {/* Título principal */}
      <h1 className="settings-title">Configurações</h1>
      <p className="settings-subtitle">
        Defina os canais que irão se conectar à sua Plataforma WhatsApp GP Labs.
      </p>

      <div className="settings-env-info">
        <span>{isDev ? "Dev · Ambiente local" : "Produção"}</span>
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

      {/* Seção: Canais de atendimento */}
      <section className="settings-section">
        <h2 className="settings-section-title">Canais de atendimento</h2>
        <p className="settings-section-description">
          Selecione um canal para ver os detalhes e configurar.
        </p>

        <div className="settings-channels-grid">
          {/* Canal: Web Site */}
          <div
            className="settings-channel-card"
            style={{ cursor: "pointer" }}
            onClick={() => ensureWebchatChannel()}
            title="Configurar Web Chat"
          >
            <div className="settings-channel-header">
              <span className="settings-channel-title">Janela Web (Web Chat)</span>
              <Pill variant={webchatStatus}>
                {webchatChannel
                  ? webchatChannel.active
                    ? "Ativo"
                    : "Desativado"
                  : "Não configurado"}
              </Pill>
            </div>
            <p className="settings-channel-description">
              Widget de atendimento para seu site. Copie o script e configure
              origens permitidas.
            </p>

            <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
              <button className="settings-primary-btn" disabled={saving}>
                {webchatChannel ? "Configurar" : "Criar canal"}
              </button>
              {webchatChannel && (
                <button
                  className="settings-primary-btn"
                  style={{ opacity: 0.85 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openWebchatConfig(webchatChannel);
                  }}
                >
                  Abrir
                </button>
              )}
            </div>
          </div>

          {/* Canal: WhatsApp */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">WhatsApp</span>
              <Pill variant="on">Conectado</Pill>
            </div>
            <p className="settings-channel-description">
              Envio e recebimento de mensagens pela API oficial do WhatsApp Business.
            </p>
          </div>

          {/* Canal: Messenger */}
          <div className="settings-channel-card" style={{ opacity: 0.8 }}>
            <div className="settings-channel-header">
              <span className="settings-channel-title">Messenger</span>
              <Pill variant="soon">Em breve</Pill>
            </div>
            <p className="settings-channel-description">
              Integração com a caixa de mensagens da sua página do Facebook.
            </p>
          </div>

          {/* Canal: Instagram */}
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
              {channels.length} canal(is) cadastrado(s) no backend.
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

      {/* Seção: WhatsApp Business API */}
      <section className="settings-section">
        <h2 className="settings-section-title">WhatsApp Business API</h2>
        <p className="settings-section-description">
          Envio e recebimento de mensagens pela API oficial do WhatsApp Business.
        </p>

        <button className="settings-primary-btn">Reconfigurar canal</button>

        <div className="settings-steps">
          <p className="settings-steps-title">Integração com WhatsApp Business API</p>
          <p className="settings-steps-description">
            Configure o token permanente, selecione a conta e valide seu número de
            WhatsApp Business.
          </p>

          <ol className="settings-steps-list">
            <li>Token Meta</li>
            <li>Conta &amp; número</li>
            <li>PIN</li>
            <li>Conectado</li>
          </ol>
        </div>
      </section>

      {/* Modal WebChat */}
      <Modal
        open={webchatOpen}
        title="Configurar Janela Web (Web Chat)"
        onClose={() => setWebchatOpen(false)}
      >
        {!webchatDraft ? (
          <div>Carregando...</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <div>
                <div style={labelStyle()}>Status</div>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={!!webchatDraft.active}
                      onChange={(e) =>
                        setWebchatDraft((p) => ({ ...p, active: e.target.checked }))
                      }
                    />
                    <span>{webchatDraft.active ? "Ativo" : "Desativado"}</span>
                  </label>
                  <span style={{ opacity: 0.75, fontSize: 12 }}>
                    (Se desativar, o widget não inicia sessão)
                  </span>
                </div>
              </div>

              <div>
                <div style={labelStyle()}>widgetKey</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={fieldStyle()}
                    value={webchatDraft.security?.widgetKey || ""}
                    readOnly
                  />
                  <button
                    className="settings-primary-btn"
                    onClick={() => copy(webchatDraft.security?.widgetKey || "")}
                  >
                    Copiar
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={rotateWidgetKey}
                    disabled={saving}
                  >
                    Rotacionar widgetKey
                  </button>
                </div>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <div>
                <div style={labelStyle()}>Nome do canal</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.settings?.name || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), name: e.target.value }
                    }))
                  }
                  placeholder="Ex: Web Chat Site"
                />
              </div>

              <div>
                <div style={labelStyle()}>Cor (primary)</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.settings?.color || "#34d399"}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), color: e.target.value }
                    }))
                  }
                  placeholder="#34d399"
                />
              </div>

              <div>
                <div style={labelStyle()}>Posição</div>
                <select
                  style={fieldStyle()}
                  value={webchatDraft.settings?.position || "right"}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), position: e.target.value }
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
                  value={webchatDraft.settings?.buttonText || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), buttonText: e.target.value }
                    }))
                  }
                  placeholder="Ajuda"
                />
              </div>

              <div>
                <div style={labelStyle()}>Título do header</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.settings?.title || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), title: e.target.value }
                    }))
                  }
                  placeholder="Atendimento"
                />
              </div>

              <div>
                <div style={labelStyle()}>Mensagem de boas-vindas</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.settings?.greeting || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      settings: { ...(p.settings || {}), greeting: e.target.value }
                    }))
                  }
                  placeholder="Olá! Como posso ajudar?"
                />
              </div>
            </div>

            <div>
              <div style={labelStyle()}>
                Allowed Origins (uma por linha) — precisa bater com o Origin do site
              </div>
              <textarea
                style={{ ...fieldStyle(), minHeight: 110, resize: "vertical" }}
                value={(webchatDraft.security?.allowedOrigins || []).join("\n")}
                onChange={(e) =>
                  setWebchatDraft((p) => ({
                    ...p,
                    security: {
                      ...(p.security || {}),
                      allowedOrigins: e.target.value
                        .split("\n")
                        .map((s) => s.trim())
                        .filter(Boolean)
                    }
                  }))
                }
                placeholder={`Ex:\nhttps://gplabs.com.br\nhttps://www.gplabs.com.br`}
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                Dica: em dev, use <code>http://localhost:5173</code>.
              </div>
            </div>

            <div>
              <div style={labelStyle()}>Script de embed</div>
              <textarea
                style={{
                  ...fieldStyle(),
                  minHeight: 120,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12
                }}
                value={getEmbedSnippet(webchatDraft)}
                readOnly
              />
              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
                <button
                  className="settings-primary-btn"
                  onClick={() => copy(getEmbedSnippet(webchatDraft))}
                >
                  Copiar embed
                </button>
                <button
                  className="settings-primary-btn"
                  style={{ opacity: 0.9 }}
                  onClick={() => copy(webchatDraft.security?.widgetKey || "")}
                >
                  Copiar widgetKey
                </button>
              </div>
            </div>

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

