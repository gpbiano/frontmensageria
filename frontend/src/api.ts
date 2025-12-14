// frontend/src/settings/SettingsChannelsPage.jsx
import React, { useEffect, useMemo, useState } from "react";

import {
  fetchChannels,
  updateWebchatChannel,
  rotateWebchatKey,
  fetchWebchatSnippet
} from "../api.ts"; // ✅ ajuste se seu bundler reclamar (pode ser "../api" também)

/**
 * Settings > Canais (modelo NOVO — compatível com backend atual)
 *
 * Backend esperado:
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
    .map((o) => o.replace(/\/+$/, "")); // remove trailing slash
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
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1"
      );
    } catch {
      return true;
    }
  }, []);

  const webchat = channelsState?.webchat || null;
  const whatsapp = channelsState?.whatsapp || null;
  const messenger = channelsState?.messenger || null;
  const instagram = channelsState?.instagram || null;

  async function loadChannels() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchChannels();
      setChannelsState(data || {});
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
  }, []);

  function openWebchatConfig() {
    const ch = webchat || {};
    // draft compatível com backend (enabled/allowedOrigins/config/widgetKey/status)
    setWebchatDraft({
      enabled: !!ch.enabled,
      status: ch.status || "disconnected",
      widgetKey: ch.widgetKey || "",
      allowedOrigins: Array.isArray(ch.allowedOrigins) ? ch.allowedOrigins : [],
      config: {
        // ⚠️ backend usa "color", front api.ts usa "primaryColor"
        // a gente mantém os dois em draft pra não perder valor dependendo do retorno
        primaryColor:
          ch?.config?.primaryColor ||
          ch?.config?.color ||
          "#34d399",
        position: ch?.config?.position === "left" ? "left" : "right",
        buttonText: ch?.config?.buttonText || "Ajuda",
        title: ch?.config?.title || "Atendimento",
        greeting: ch?.config?.greeting || "Olá! Como posso ajudar?"
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
      // seu backend retorna { ok, widgetJsUrl, widgetKey, allowedOrigins, scriptTag, env... }
      const scriptTag = res?.scriptTag || res?.snippet || "";
      setSnippet(scriptTag);
      setSnippetMeta(res || null);
    } catch (e) {
      // não trava modal por causa disso
      console.warn("Erro ao buscar snippet:", e);
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
      const allowedOrigins = Array.isArray(webchatDraft.allowedOrigins)
        ? webchatDraft.allowedOrigins
        : [];

      // ✅ manda no formato do backend
      const payload = {
        enabled: !!webchatDraft.enabled,
        allowedOrigins,
        // backend espera config.color; sua api.ts tipa primaryColor — vamos mandar os dois por segurança
        config: {
          ...webchatDraft.config,
          color: webchatDraft.config?.primaryColor || webchatDraft.config?.color
        }
      };

      await updateWebchatChannel(payload);
      await loadChannels();

      setToast("Configuração salva.");
      setTimeout(() => setToast(""), 2000);

      // atualiza snippet pra refletir widgetKey/URL atuais
      await loadSnippet();
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSaving(false);
    }
  }

  async function rotateKey() {
    const ok = confirm(
      "Rotacionar a widgetKey invalida os scripts antigos. Tem certeza?"
    );
    if (!ok) return;

    setSaving(true);
    setError("");
    try {
      const res = await rotateWebchatKey();
      const newKey = res?.widgetKey || "";

      setWebchatDraft((p) =>
        p ? { ...p, widgetKey: newKey } : p
      );

      await loadChannels();
      await loadSnippet();

      setToast("widgetKey rotacionada.");
      setTimeout(() => setToast(""), 2000);
    } catch (e) {
      setError(e.message || String(e));
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
      // fallback: nada
    }
  }

  const webchatStatusVariant = webchat?.enabled ? "on" : "off";
  const whatsappVariant = whatsapp?.enabled ? "on" : "off";

  const webchatStatusLabel = webchat
    ? webchat.enabled
      ? "Ativo"
      : "Desativado"
    : "Não configurado";

  const whatsappLabel = whatsapp?.status
    ? whatsapp.status === "connected"
      ? "Conectado"
      : "Desconectado"
    : "Conectado";

  function embedFallbackFromDraft() {
    const widgetKey = webchatDraft?.widgetKey || webchat?.widgetKey || "wkey_xxx";
    // ✅ para PROD, você disse que API é api.gplabs.com.br
    // se o site estiver em dev, usa API base do env do Vite
    const apiBase = isDev
      ? (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || "http://localhost:3010")
      : "https://api.gplabs.com.br";

    return `<script
  src="https://widget.gplabs.com.br/widget.js"
  data-widget-key="${widgetKey}"
  data-api-base="${apiBase}"
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
          {/* Web Chat */}
          <div
            className="settings-channel-card"
            style={{ cursor: "pointer" }}
            onClick={() => openWebchatConfig()}
            title="Configurar Web Chat"
          >
            <div className="settings-channel-header">
              <span className="settings-channel-title">
                Janela Web (Web Chat)
              </span>
              <Pill variant={webchatStatusVariant}>{webchatStatusLabel}</Pill>
            </div>

            <p className="settings-channel-description">
              Widget de atendimento para seu site. Copie o script e configure
              origens permitidas.
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
                {whatsappVariant === "on" ? whatsappLabel : "Desativado"}
              </Pill>
            </div>
            <p className="settings-channel-description">
              Envio e recebimento de mensagens pela API oficial do WhatsApp
              Business.
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
              Mensagens diretas (DM) do Instagram integradas no painel de
              atendimento.
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

      {/* Seção: WhatsApp Business API */}
      <section className="settings-section">
        <h2 className="settings-section-title">WhatsApp Business API</h2>
        <p className="settings-section-description">
          Envio e recebimento de mensagens pela API oficial do WhatsApp Business.
        </p>

        <button className="settings-primary-btn" disabled>
          Reconfigurar canal
        </button>

        <div className="settings-steps">
          <p className="settings-steps-title">
            Integração com WhatsApp Business API
          </p>
          <p className="settings-steps-description">
            Configure o token permanente, selecione a conta e valide seu número
            de WhatsApp Business.
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
            {/* topo: enabled + widgetKey */}
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
                  <label
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
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
                  <span style={{ opacity: 0.75, fontSize: 12 }}>
                    (Se desativar, o widget pode até carregar, mas o backend
                    bloqueia a sessão)
                  </span>
                </div>
              </div>

              <div>
                <div style={labelStyle()}>widgetKey</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    style={fieldStyle()}
                    value={webchatDraft.widgetKey || ""}
                    readOnly
                  />
                  <button
                    className="settings-primary-btn"
                    onClick={() => copy(webchatDraft.widgetKey || "")}
                  >
                    Copiar
                  </button>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={rotateKey}
                    disabled={saving}
                  >
                    Rotacionar widgetKey
                  </button>
                </div>
              </div>
            </div>

            {/* config */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12
              }}
            >
              <div>
                <div style={labelStyle()}>Cor (primary)</div>
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
                <div style={labelStyle()}>Posição</div>
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
                      config: {
                        ...(p.config || {}),
                        buttonText: e.target.value
                      }
                    }))
                  }
                  placeholder="Ajuda"
                />
              </div>

              <div>
                <div style={labelStyle()}>Título do header</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.title || ""}
                  onChange={(e) =>
                    setWebchatDraft((p) => ({
                      ...p,
                      config: { ...(p.config || {}), title: e.target.value }
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
                      config: {
                        ...(p.config || {}),
                        greeting: e.target.value
                      }
                    }))
                  }
                  placeholder="Olá! Como posso ajudar?"
                />
              </div>
            </div>

            {/* origins */}
            <div>
              <div style={labelStyle()}>
                Allowed Origins (uma por linha) — precisa bater com o Origin do
                site
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
                placeholder={`Ex:\nhttps://gplabs.com.br\nhttps://www.gplabs.com.br`}
              />
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                Dica: em dev, use <code>http://localhost:5173</code> e{" "}
                <code>http://127.0.0.1:5173</code>.
              </div>
              {isDev && (!webchatDraft.allowedOrigins || webchatDraft.allowedOrigins.length === 0) && (
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
                    Preencher origins de dev
                  </button>
                </div>
              )}
            </div>

            {/* snippet */}
            <div>
              <div style={labelStyle()}>
                Script de embed{" "}
                <span style={{ opacity: 0.75 }}>
                  (gerado pelo backend; se falhar, usamos fallback)
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
                value={snippetLoading ? "Carregando snippet..." : embedSnippet}
                readOnly
              />

              <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
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
                >
                  Copiar widgetKey
                </button>
                <button
                  className="settings-primary-btn"
                  style={{ opacity: 0.9 }}
                  onClick={() => loadSnippet()}
                  disabled={snippetLoading}
                >
                  {snippetLoading ? "Atualizando..." : "Atualizar snippet"}
                </button>
              </div>

              {!!snippetMeta?.allowedOrigins?.length && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  Origins no backend:{" "}
                  <code>{(snippetMeta.allowedOrigins || []).join(", ")}</code>
                </div>
              )}
            </div>

            {/* ações */}
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
