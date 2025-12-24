// frontend/src/settings/SettingsChannelsPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchChannels,
  updateWebchatChannel,
  rotateWebchatKey,
  fetchWebchatSnippet,

  // WhatsApp Embedded Signup
  startWhatsAppEmbeddedSignup,
  finishWhatsAppEmbeddedSignup,
  disconnectWhatsAppChannel
} from "../../api";

/* ======================================================
 * UI Helpers
 * ====================================================== */

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
          >
            ✕
          </button>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

/* ======================================================
 * WhatsApp SDK
 * ====================================================== */

function loadFacebookSdk(appId) {
  return new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);

    window.fbAsyncInit = function () {
      try {
        window.FB.init({
          appId,
          cookie: true,
          xfbml: false,
          version: "v19.0"
        });
        resolve(window.FB);
      } catch (e) {
        reject(e);
      }
    };

    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.onerror = () => reject(new Error("Falha ao carregar Facebook SDK"));
    document.head.appendChild(s);
  });
}

/* ======================================================
 * Utils
 * ====================================================== */

function normalizeChannelStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "not_connected";
  if (s === "connected") return "connected";
  if (s === "disabled") return "disabled";
  if (s === "disconnected") return "disconnected";
  return s;
}

/* ======================================================
 * Page
 * ====================================================== */

export default function SettingsChannelsPage() {
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [channelsState, setChannelsState] = useState(null);
  const [error, setError] = useState("");

  const [waConnecting, setWaConnecting] = useState(false);
  const [waErr, setWaErr] = useState("");
  const [waDebug, setWaDebug] = useState(null);

  const whatsapp = channelsState?.whatsapp || null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function loadChannels() {
    setLoading(true);
    setError("");
    try {
      const data = await fetchChannels();
      if (!mountedRef.current) return;
      setChannelsState(data || {});
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e?.message || String(e));
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
  }, []);

  /* ======================================================
   * WhatsApp Embedded Signup
   * ====================================================== */

  async function connectWhatsApp() {
    setWaErr("");
    setWaDebug(null);
    setWaConnecting(true);

    try {
      const start = await startWhatsAppEmbeddedSignup();

      const appId = start?.appId;
      const state = start?.state;
      const redirectUri = start?.redirectUri;
      const scopes =
        start?.scopes || ["whatsapp_business_messaging", "business_management"];

      if (!appId || !state || !redirectUri) {
        throw new Error("Resposta inválida do backend (appId/state/redirectUri).");
      }

      const FB = await loadFacebookSdk(appId);

      FB.login(
        (response) => {
          (async () => {
            try {
              if (!response?.authResponse) {
                throw new Error("Usuário cancelou ou não autorizou.");
              }

              const code = response.authResponse.code;
              if (!code) throw new Error("Meta não retornou authorization code.");

              await finishWhatsAppEmbeddedSignup({ code, state });
              await loadChannels();
            } catch (e) {
              setWaErr(e?.message || String(e));
              setWaDebug(response || null);
            } finally {
              setWaConnecting(false);
            }
          })();
        },
        {
          scope: scopes.join(","),
          response_type: "code",
          override_default_response_type: true,
          return_scopes: true,
          redirect_uri: redirectUri // ⚠️ NUNCA alterar
        }
      );
    } catch (e) {
      if (!mountedRef.current) return;
      setWaErr(e?.message || String(e));
      setWaConnecting(false);
    }
  }

  async function disconnectWhatsApp() {
    const ok = confirm("Deseja desconectar o WhatsApp deste tenant?");
    if (!ok) return;

    setWaErr("");
    setWaConnecting(true);

    try {
      await disconnectWhatsAppChannel();
      await loadChannels();
    } catch (e) {
      setWaErr(e?.message || String(e));
    } finally {
      setWaConnecting(false);
    }
  }

  const waStatus = normalizeChannelStatus(whatsapp?.status);
  const waIsConnected = waStatus === "connected";

  return (
    <div className="settings-page">
      <h1 className="settings-title">Configurações</h1>

      {!!error && <div className="error-box">{error}</div>}

      <section className="settings-section">
        <h2>Canais de atendimento</h2>

        <div className="settings-channel-card">
          <div className="settings-channel-header">
            <span>WhatsApp</span>
            <Pill variant={waIsConnected ? "on" : "off"}>
              {waIsConnected ? "Conectado" : "Não conectado"}
            </Pill>
          </div>

          {!!waErr && <div className="error-box">{waErr}</div>}

          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            {!waIsConnected ? (
              <button
                className="settings-primary-btn"
                onClick={connectWhatsApp}
                disabled={waConnecting}
              >
                {waConnecting ? "Conectando..." : "Conectar WhatsApp"}
              </button>
            ) : (
              <button
                className="settings-primary-btn"
                onClick={disconnectWhatsApp}
                disabled={waConnecting}
              >
                Desconectar
              </button>
            )}
          </div>
        </div>

        {loading && <div style={{ marginTop: 12 }}>Carregando canais...</div>}
      </section>
    </div>
  );
}
