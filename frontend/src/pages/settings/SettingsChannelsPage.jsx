// frontend/src/pages/settings/SettingsChannelsPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchChannels,
  updateWebchatChannel,
  rotateWebchatKey,
  fetchWebchatSnippet,

  // ✅ WhatsApp Embedded Signup
  startWhatsAppEmbeddedSignup,
  finishWhatsAppEmbeddedSignup,
  disconnectWhatsAppChannel,

  // ✅ Messenger (Settings UI)
  listMessengerPages,
  connectMessengerChannel,
  disconnectMessengerChannel,

  // ✅ Instagram (Zenvia-like) — ALINHADO COM api.ts
  startInstagramBusinessLogin,
  finishInstagramBusinessLogin,
  connectInstagramChannel,
  disconnectInstagramChannel
} from "../../api"; // pages/settings -> ../../api

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

function normalizeChannelStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (!s) return "not_connected";
  if (s === "connected" || s === "on") return "connected";
  if (s === "disabled") return "disabled";
  if (s === "disconnected") return "disconnected";
  if (s === "not_connected") return "not_connected";
  return s;
}

function unwrapChannelsResponse(data) {
  if (!data) return {};
  if (data.channels && typeof data.channels === "object" && !Array.isArray(data.channels)) {
    return data.channels;
  }
  if (data.webchat || data.whatsapp || data.messenger || data.instagram) return data;
  if (data.channels && Array.isArray(data.channels)) {
    const out = {};
    for (const row of data.channels) out[row.channel] = row;
    return out;
  }
  return data;
}

function safeArr(x) {
  return Array.isArray(x) ? x : [];
}

function extractErr(e) {
  const msg =
    e?.response?.data?.error ||
    e?.response?.data?.message ||
    e?.message ||
    (typeof e === "string" ? e : "");
  const code = e?.response?.data?.code || e?.code || "";
  return { msg: String(msg || ""), code: String(code || "") };
}

// ✅ Detecta canal pelo PATH (mais confiável que state)
function detectChannelByPath(pathname) {
  const p = String(pathname || "");
  if (/\/settings\/channels\/instagram\/callback$/i.test(p)) return "instagram";
  if (/\/settings\/channels\/whatsapp\/callback$/i.test(p)) return "whatsapp";
  return "";
}

export default function SettingsChannelsPage() {
  const mountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [channelsState, setChannelsState] = useState({});
  const [error, setError] = useState("");

  const [webchatOpen, setWebchatOpen] = useState(false);
  const [webchatDraft, setWebchatDraft] = useState(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const [snippetLoading, setSnippetLoading] = useState(false);
  const [snippet, setSnippet] = useState("");
  const [snippetMeta, setSnippetMeta] = useState(null);

  // ✅ WhatsApp state
  const [waConnecting, setWaConnecting] = useState(false);
  const [waModalOpen, setWaModalOpen] = useState(false);
  const [waErr, setWaErr] = useState("");

  // ✅ Messenger state
  const [msModalOpen, setMsModalOpen] = useState(false);
  const [msConnecting, setMsConnecting] = useState(false);
  const [msErr, setMsErr] = useState("");
  const [msPages, setMsPages] = useState([]);
  const [msSelectedPageId, setMsSelectedPageId] = useState("");
  const [msSubFields, setMsSubFields] = useState("messages,messaging_postbacks");
  const [msUserToken, setMsUserToken] = useState("");

  // ✅ Instagram state
  const [igModalOpen, setIgModalOpen] = useState(false);
  const [igConnecting, setIgConnecting] = useState(false);
  const [igErr, setIgErr] = useState("");
  const [igPages, setIgPages] = useState([]);
  const [igSelectedPageId, setIgSelectedPageId] = useState("");
  const [igConnectState, setIgConnectState] = useState(""); // ✅ state assinado do backend p/ conectar

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const isDev = useMemo(() => {
    try {
      return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    } catch {
      return false;
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
      if (!mountedRef.current) return;
      const unwrapped = unwrapChannelsResponse(data);
      setChannelsState(unwrapped || {});
    } catch (e) {
      if (!mountedRef.current) return;
      setError(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===============================
  // ✅ Webchat
  // ===============================
  function openWebchatConfig() {
    const ch = webchat || {};
    const cfg = ch?.config || {};

    const headerTitle = cfg.headerTitle || cfg.title || "Atendimento";
    const buttonText = cfg.buttonText || "Ajuda";
    const greeting = cfg.greeting || "Olá! Como posso ajudar?";
    const position = cfg.position === "left" ? "left" : "right";
    const primaryColor = cfg.primaryColor || cfg.color || "#34d399";

    const allowedOriginsFromRecord = Array.isArray(ch.allowedOrigins)
      ? ch.allowedOrigins
      : Array.isArray(cfg.allowedOrigins)
      ? cfg.allowedOrigins
      : [];

    setWebchatDraft({
      enabled: !!ch.enabled,
      widgetKey: ch.widgetKey || "",
      allowedOrigins: allowedOriginsFromRecord,
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
      if (!mountedRef.current) return;
      const scriptTag = res?.scriptTag || res?.snippet || "";
      setSnippet(scriptTag);
      setSnippetMeta(res || null);
    } catch {
      if (!mountedRef.current) return;
      setSnippet("");
      setSnippetMeta(null);
    } finally {
      if (!mountedRef.current) return;
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
      const primaryColor = String(cfg.primaryColor || "#34d399").trim();

      const payload = {
        enabled: !!webchatDraft.enabled,
        allowedOrigins: Array.isArray(webchatDraft.allowedOrigins) ? webchatDraft.allowedOrigins : [],
        config: {
          primaryColor,
          color: primaryColor,
          position: cfg.position === "left" ? "left" : "right",
          buttonText: String(cfg.buttonText || "Ajuda"),
          headerTitle: String(cfg.headerTitle || "Atendimento"),
          title: String(cfg.headerTitle || "Atendimento"),
          greeting: String(cfg.greeting || "Olá! Como posso ajudar?")
        }
      };

      await updateWebchatChannel(payload);
      await loadChannels();
      await loadSnippet();

      if (!mountedRef.current) return;
      setToast("Configuração salva com sucesso.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setSaving(false);
    }
  }

  async function rotateKey() {
    const ok = confirm("Ao rotacionar a chave, scripts antigos deixarão de funcionar. Deseja continuar?");
    if (!ok) return;

    setSaving(true);
    setError("");

    try {
      const res = await rotateWebchatKey();
      const newKey = res?.widgetKey || "";
      setWebchatDraft((p) => (p ? { ...p, widgetKey: newKey } : p));

      await loadChannels();
      await loadSnippet();

      if (!mountedRef.current) return;
      setToast("Chave atualizada.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setSaving(false);
    }
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(String(text || ""));
      setToast("Copiado!");
      setTimeout(() => mountedRef.current && setToast(""), 1200);
    } catch {
      // sem fallback
    }
  }

  const webchatStatusVariant = webchat?.enabled ? "on" : "off";

  // ===============================
  // ✅ WhatsApp
  // ===============================
  const waStatus = normalizeChannelStatus(whatsapp?.status);
  const waIsConnected = waStatus === "connected" || whatsapp?.enabled === true;
  const whatsappVariant = waIsConnected ? "on" : "off";

  function whatsappLabel() {
    if (waIsConnected) return "Conectado";
    if (waStatus === "disabled") return "Desativado";
    return "Não conectado";
  }

  function embedFallbackFromDraft() {
    const widgetKey = webchatDraft?.widgetKey || webchat?.widgetKey || "wkey_xxx";

    const apiBase = isDev
      ? import.meta.env.VITE_API_BASE || import.meta.env.VITE_API_BASE_URL || "http://localhost:3010"
      : "https://api.gplabs.com.br";

    const cfg = webchatDraft?.config || {};
    const color = String(cfg.primaryColor || "#34d399").trim();
    const position = cfg.position === "left" ? "left" : "right";
    const buttonText = String(cfg.buttonText || "Ajuda").replace(/"/g, "&quot;");
    const title = String(cfg.headerTitle || "Atendimento").replace(/"/g, "&quot;");
    const greeting = String(cfg.greeting || "Olá! Como posso ajudar?").replace(/"/g, "&quot;");

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

  // ✅ Normaliza resposta do backend (aceita appId/app_id etc)
  function normalizeMetaStart(start) {
    const appId = start?.appId || start?.app_id || start?.clientId || start?.client_id;
    const state = start?.state;
    const redirectUri =
      start?.redirectUri ||
      start?.redirect_uri ||
      start?.redirectURL ||
      start?.redirect_url ||
      "";

    const scopes = start?.scopes || start?.scope || [];
    const graphVersion = start?.graphVersion || start?.version || "v21.0";

    return {
      appId: appId ? String(appId) : "",
      state: state ? String(state) : "",
      redirectUri: redirectUri ? String(redirectUri) : "",
      scopes: Array.isArray(scopes)
        ? scopes.map(String)
        : String(scopes || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
      graphVersion: String(graphVersion || "v21.0")
    };
  }

  function buildFrontendCallbackUrl(channel) {
    const origin = window.location.origin;
    return `${origin}/settings/channels/${channel}/callback`;
  }

  async function connectWhatsApp() {
    setWaErr("");
    setWaConnecting(true);

    try {
      const startRaw = await startWhatsAppEmbeddedSignup();
      const start = normalizeMetaStart(startRaw);

      const redirectUri = start.redirectUri || buildFrontendCallbackUrl("whatsapp");

      if (!start.appId || !start.state) {
        throw new Error(
          `Resposta inválida do backend (appId/state). Recebido: ${JSON.stringify(startRaw)}`
        );
      }

      const params = new URLSearchParams({
        client_id: String(start.appId),
        redirect_uri: redirectUri,
        state: String(start.state),
        response_type: "code",
        scope: (start.scopes.length ? start.scopes : ["whatsapp_business_messaging", "business_management"]).join(",")
      });

      window.location.href = `https://www.facebook.com/${encodeURIComponent(start.graphVersion)}/dialog/oauth?${params.toString()}`;
    } catch (e) {
      if (!mountedRef.current) return;
      setWaErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
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
      if (!mountedRef.current) return;

      setToast("WhatsApp desconectado.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
    } catch (e) {
      if (!mountedRef.current) return;
      setWaErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setWaConnecting(false);
    }
  }

  // ===============================
  // ✅ Messenger
  // ===============================
  const msStatus = normalizeChannelStatus(messenger?.status);
  const msIsConnected = msStatus === "connected" || messenger?.enabled === true;
  const messengerVariant = msIsConnected ? "on" : "off";

  function messengerLabel() {
    if (msIsConnected) return "Conectado";
    if (msStatus === "disabled") return "Desativado";
    if (msStatus === "disconnected") return "Desconectado";
    return "Não conectado";
  }

  function openMessengerModal() {
    setMsErr("");
    setMsPages([]);
    setMsSelectedPageId("");
    setMsSubFields("messages,messaging_postbacks");
    setMsUserToken("");
    setMsModalOpen(true);
  }

  async function loadMessengerPages() {
    setMsErr("");
    setMsConnecting(true);

    try {
      const token = String(msUserToken || "").trim();
      if (!token) throw new Error("Cole um User Access Token (Graph) para listar páginas.");
      const res = await listMessengerPages(token);

      const pages = safeArr(res?.pages).filter((p) => p?.id && p?.name);

      if (!mountedRef.current) return;

      setMsPages(pages);
      if (pages.length === 1) setMsSelectedPageId(String(pages[0].id));
      if (!pages.length) setMsErr("Nenhuma página retornada. Verifique permissões do token.");
    } catch (e) {
      if (!mountedRef.current) return;
      setMsErr(extractErr(e).msg || String(e));
      setMsPages([]);
    } finally {
      if (!mountedRef.current) return;
      setMsConnecting(false);
    }
  }

  async function connectMessenger() {
    setMsErr("");
    setMsConnecting(true);

    try {
      const pageId = String(msSelectedPageId || "").trim();
      if (!pageId) throw new Error("Selecione uma página.");

      const page = msPages.find((p) => String(p.id) === pageId);
      const pageAccessToken = String(page?.pageAccessToken || "").trim();
      if (!pageAccessToken) throw new Error("Página selecionada sem pageAccessToken. Recarregue as páginas.");

      const subscribedFields = String(msSubFields || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await connectMessengerChannel({ pageId, pageAccessToken, subscribedFields });
      await loadChannels();

      if (!mountedRef.current) return;
      setToast("Messenger conectado com sucesso.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
      setMsModalOpen(false);
    } catch (e) {
      if (!mountedRef.current) return;
      setMsErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setMsConnecting(false);
    }
  }

  async function disconnectMessenger() {
    const ok = confirm("Deseja desconectar o Messenger deste tenant?");
    if (!ok) return;

    setMsErr("");
    setMsConnecting(true);

    try {
      await disconnectMessengerChannel();
      await loadChannels();

      if (!mountedRef.current) return;
      setToast("Messenger desconectado.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
    } catch (e) {
      if (!mountedRef.current) return;
      setMsErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setMsConnecting(false);
    }
  }

  // ===============================
  // ✅ Instagram
  // ===============================
  const igStatus = normalizeChannelStatus(instagram?.status);
  const igIsConnected = igStatus === "connected" || instagram?.enabled === true;
  const instagramVariant = igIsConnected ? "on" : "off";

  function instagramLabel() {
    if (igIsConnected) return "Conectado";
    if (igStatus === "disabled") return "Desativado";
    if (igStatus === "disconnected") return "Desconectado";
    return "Não conectado";
  }

  function openInstagramModal() {
    setIgErr("");
    setIgModalOpen(true);
  }

  async function startInstagramConnect() {
    setIgErr("");
    setIgConnecting(true);

    try {
      const start = await startInstagramBusinessLogin();

      const appId = start?.appId;
      const state = start?.state;

      // fallback: callback no front
      const redirectUri =
        String(start?.redirectUri || "").trim() || buildFrontendCallbackUrl("instagram");

      const scopes = Array.isArray(start?.scopes) ? start.scopes : [];
      const authBaseUrl = String(start?.authBaseUrl || "https://www.facebook.com").trim();
      const graphVersion = String(start?.graphVersion || "v21.0").trim();

      if (!appId || !state) {
        throw new Error(`Instagram start inválido (appId/state). Recebido: ${JSON.stringify(start)}`);
      }

      const params = new URLSearchParams({
        client_id: String(appId),
        redirect_uri: redirectUri,
        state: String(state),
        response_type: "code",
        scope: (scopes.length
          ? scopes
          : [
              "pages_show_list",
              "pages_read_engagement",
              "pages_manage_metadata",
              "pages_messaging",
              "instagram_basic",
              "instagram_manage_messages"
            ]
        ).join(",")
      });

      window.location.href = `${authBaseUrl}/${encodeURIComponent(graphVersion)}/dialog/oauth?${params.toString()}`;
    } catch (e) {
      if (!mountedRef.current) return;
      setIgErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setIgConnecting(false);
    }
  }

  async function finalizeInstagramWithPage() {
    setIgErr("");
    setIgConnecting(true);

    try {
      const pageId = String(igSelectedPageId || "").trim();
      if (!pageId) throw new Error("Selecione uma página.");
      const cs = String(igConnectState || "").trim();
      if (!cs) throw new Error("connectState ausente/expirado. Clique em “Conectar com Instagram” novamente.");

      await connectInstagramChannel({
        pageId,
        connectState: cs,
        subscribedFields: ["messages"]
      });

      await loadChannels();

      if (!mountedRef.current) return;
      setToast("Instagram conectado com sucesso.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);

      setIgModalOpen(false);
      setIgPages([]);
      setIgSelectedPageId("");
      setIgConnectState("");
    } catch (e) {
      if (!mountedRef.current) return;
      setIgErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setIgConnecting(false);
    }
  }

  async function disconnectInstagram() {
    const ok = confirm("Deseja desconectar o Instagram deste tenant?");
    if (!ok) return;

    setIgErr("");
    setIgConnecting(true);

    try {
      await disconnectInstagramChannel();
      await loadChannels();

      if (!mountedRef.current) return;
      setToast("Instagram desconectado.");
      setTimeout(() => mountedRef.current && setToast(""), 2000);
    } catch (e) {
      if (!mountedRef.current) return;
      setIgErr(extractErr(e).msg || String(e));
    } finally {
      if (!mountedRef.current) return;
      setIgConnecting(false);
    }
  }

  // ===============================
  // ✅ CALLBACK HANDLER (só em /callback)
  // ===============================
  useEffect(() => {
    try {
      const url = new URL(window.location.href);

      const channel = detectChannelByPath(url.pathname);
      if (!channel) return; // ✅ não é callback

      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");

      const err = url.searchParams.get("error");
      const errDesc =
        url.searchParams.get("error_description") || url.searchParams.get("error_message");

      if (err) {
        const msg = String(errDesc || err);
        if (channel === "instagram") setIgErr(msg);
        else setWaErr(msg);
        return;
      }

      if (!code || !state) return;

      (async () => {
        try {
          if (channel === "instagram") {
            setIgConnecting(true);

            const fin = await finishInstagramBusinessLogin({ code, state });

            const pages = safeArr(fin?.pages).filter((p) => p?.id && p?.name);
            const cs = String(fin?.connectState || "").trim();

            if (!cs) throw new Error("Instagram: connectState não retornado no callback.");
            if (!pages.length) throw new Error("Instagram: nenhuma página retornada (verifique permissões).");

            if (!mountedRef.current) return;

            setIgConnectState(cs);
            setIgPages(pages);
            if (pages.length === 1) setIgSelectedPageId(String(pages[0].id));
            setIgModalOpen(true);

            setToast(pages.length > 1 ? "Escolha a página para conectar." : "Página carregada.");
            setTimeout(() => mountedRef.current && setToast(""), 2000);
          } else {
            // WhatsApp
            setWaConnecting(true);
            await finishWhatsAppEmbeddedSignup({ code, state });
            await loadChannels();

            if (!mountedRef.current) return;
            setToast("WhatsApp conectado com sucesso.");
            setTimeout(() => mountedRef.current && setToast(""), 2000);
          }

          // ✅ limpa query
          url.searchParams.delete("code");
          url.searchParams.delete("state");
          url.searchParams.delete("error");
          url.searchParams.delete("error_description");
          url.searchParams.delete("error_message");
          window.history.replaceState({}, "", url.toString());
        } catch (e) {
          if (!mountedRef.current) return;
          const msg = extractErr(e).msg || String(e);
          if (channel === "instagram") setIgErr(msg);
          else setWaErr(msg);
        } finally {
          if (!mountedRef.current) return;
          setWaConnecting(false);
          setIgConnecting(false);
        }
      })();
    } catch {
      // ignora
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="settings-page">
      <h1 className="settings-title">Configurações</h1>
      <p className="settings-subtitle">Defina os canais que irão se conectar à sua Plataforma WhatsApp GP Labs.</p>

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
        <p className="settings-section-description">Selecione um canal para ver os detalhes e configurar.</p>

        <div className="settings-channels-grid">
          {/* Web Chat */}
          <div
            className="settings-channel-card"
            style={{ cursor: "pointer" }}
            onClick={openWebchatConfig}
            title="Configurar Web Chat"
          >
            <div className="settings-channel-header">
              <span className="settings-channel-title">Janela Web (Web Chat)</span>
              <Pill variant={webchatStatusVariant}>{webchat?.enabled ? "Ativo" : "Desativado"}</Pill>
            </div>

            <p className="settings-channel-description">Atendimento via chat integrado ao seu site.</p>

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
              <Pill variant={whatsappVariant}>{whatsappLabel()}</Pill>
            </div>

            <p className="settings-channel-description">Conecte seu WhatsApp Business via Cadastro Incorporado (Meta).</p>

            {!!waErr && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(248,113,113,.35)",
                  background: "rgba(248,113,113,.10)",
                  color: "#fecaca",
                  fontSize: 12
                }}
              >
                {waErr}
              </div>
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!waIsConnected ? (
                <button className="settings-primary-btn" onClick={connectWhatsApp} disabled={waConnecting}>
                  {waConnecting ? "Conectando..." : "Conectar WhatsApp"}
                </button>
              ) : (
                <>
                  <button className="settings-primary-btn" onClick={() => setWaModalOpen(true)} disabled={waConnecting}>
                    Detalhes
                  </button>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={disconnectWhatsApp}
                    disabled={waConnecting}
                  >
                    {waConnecting ? "..." : "Desconectar"}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Messenger */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">Messenger</span>
              <Pill variant={messengerVariant}>{messengerLabel()}</Pill>
            </div>

            <p className="settings-channel-description">Integração com a caixa de mensagens da sua página do Facebook.</p>

            {!!msErr && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(248,113,113,.35)",
                  background: "rgba(248,113,113,.10)",
                  color: "#fecaca",
                  fontSize: 12
                }}
              >
                {msErr}
              </div>
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!msIsConnected ? (
                <button className="settings-primary-btn" onClick={openMessengerModal} disabled={msConnecting}>
                  {msConnecting ? "..." : "Conectar Messenger"}
                </button>
              ) : (
                <>
                  <button className="settings-primary-btn" onClick={openMessengerModal} disabled={msConnecting}>
                    Detalhes
                  </button>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={disconnectMessenger}
                    disabled={msConnecting}
                  >
                    {msConnecting ? "..." : "Desconectar"}
                  </button>
                </>
              )}
            </div>

            {msIsConnected && (messenger?.displayName || messenger?.pageId) && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                <div>
                  <b>Página:</b> {messenger?.displayName || "—"}
                </div>
                <div>
                  <b>pageId:</b> <code style={{ opacity: 0.9 }}>{messenger?.pageId || "—"}</code>
                </div>
              </div>
            )}
          </div>

          {/* Instagram */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">Instagram</span>
              <Pill variant={instagramVariant}>{instagramLabel()}</Pill>
            </div>

            <p className="settings-channel-description">
              Mensagens diretas (DM) do Instagram integradas no painel de atendimento.
            </p>

            {!!igErr && (
              <div
                style={{
                  marginTop: 10,
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(248,113,113,.35)",
                  background: "rgba(248,113,113,.10)",
                  color: "#fecaca",
                  fontSize: 12
                }}
              >
                {igErr}
              </div>
            )}

            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!igIsConnected ? (
                <button className="settings-primary-btn" onClick={openInstagramModal} disabled={igConnecting}>
                  {igConnecting ? "..." : "Conectar Instagram"}
                </button>
              ) : (
                <>
                  <button className="settings-primary-btn" onClick={openInstagramModal} disabled={igConnecting}>
                    Detalhes
                  </button>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={disconnectInstagram}
                    disabled={igConnecting}
                  >
                    {igConnecting ? "..." : "Desconectar"}
                  </button>
                </>
              )}
            </div>

            {igIsConnected && (instagram?.displayName || instagram?.pageId) && (
              <div style={{ marginTop: 10, fontSize: 12, opacity: 0.9 }}>
                <div>
                  <b>Página:</b> {instagram?.displayName || "—"}
                </div>
                <div>
                  <b>pageId:</b> <code style={{ opacity: 0.9 }}>{instagram?.pageId || "—"}</code>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ marginTop: 14, opacity: 0.9 }}>
          {loading ? (
            <span>Carregando canais...</span>
          ) : (
            <span>
              Canais carregados do backend.
              <button
                style={{ marginLeft: 10, all: "unset", cursor: "pointer", textDecoration: "underline" }}
                onClick={loadChannels}
              >
                Recarregar
              </button>
            </span>
          )}
        </div>
      </section>

      {/* ✅ Modal Messenger */}
      <Modal
        open={msModalOpen}
        title={msIsConnected ? "Messenger — Detalhes" : "Conectar Messenger"}
        onClose={() => setMsModalOpen(false)}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.9 }}>
            <div>
              <b>Status:</b> {msIsConnected ? "Conectado" : messengerLabel()}
            </div>
            {msIsConnected && (
              <>
                <div style={{ marginTop: 6 }}>
                  <b>Página:</b> {messenger?.displayName || "—"}
                </div>
                <div style={{ marginTop: 4 }}>
                  <b>pageId:</b> <code>{messenger?.pageId || "—"}</code>
                </div>
              </>
            )}
          </div>

          {!msIsConnected && (
            <>
              <div>
                <div style={labelStyle()}>User Access Token (Graph)</div>
                <input
                  style={fieldStyle()}
                  value={msUserToken}
                  onChange={(e) => setMsUserToken(e.target.value)}
                  placeholder="Cole aqui o user access token"
                />
              </div>

              <button className="settings-primary-btn" onClick={loadMessengerPages} disabled={msConnecting}>
                {msConnecting ? "Carregando..." : "Carregar páginas"}
              </button>

              <div>
                <div style={labelStyle()}>Página</div>
                <select
                  style={fieldStyle()}
                  value={msSelectedPageId}
                  onChange={(e) => setMsSelectedPageId(e.target.value)}
                  disabled={!msPages.length}
                >
                  <option value="">Selecione…</option>
                  {msPages.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <div style={labelStyle()}>Eventos (subscribed_fields)</div>
                <input
                  style={fieldStyle()}
                  value={msSubFields}
                  onChange={(e) => setMsSubFields(e.target.value)}
                  placeholder="messages,messaging_postbacks"
                />
              </div>

              {!!msErr && (
                <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(248,113,113,.35)", background: "rgba(248,113,113,.10)", color: "#fecaca", fontSize: 12 }}>
                  {msErr}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="settings-primary-btn" style={{ opacity: 0.85 }} onClick={() => setMsModalOpen(false)} disabled={msConnecting}>
                  Cancelar
                </button>
                <button className="settings-primary-btn" onClick={connectMessenger} disabled={msConnecting || !msSelectedPageId}>
                  {msConnecting ? "Conectando..." : "Conectar"}
                </button>
              </div>
            </>
          )}

          {msIsConnected && (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="settings-primary-btn" style={{ opacity: 0.9 }} onClick={disconnectMessenger} disabled={msConnecting}>
                {msConnecting ? "..." : "Desconectar"}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* ✅ Modal Instagram */}
      <Modal
        open={igModalOpen}
        title={igIsConnected ? "Instagram — Detalhes" : "Conectar Instagram"}
        onClose={() => setIgModalOpen(false)}
      >
        <div style={{ display: "grid", gap: 12 }}>
          {!igIsConnected ? (
            <>
              <div style={{ fontSize: 12, opacity: 0.85, lineHeight: 1.45 }}>
                1) Clique em <b>“Conectar com Instagram”</b>
                <br />
                2) Autorize na Meta
                <br />
                3) Selecione a Página retornada
              </div>

              <button className="settings-primary-btn" onClick={startInstagramConnect} disabled={igConnecting}>
                {igConnecting ? "Abrindo..." : "Conectar com Instagram"}
              </button>

              {!!igPages.length && (
                <div>
                  <div style={labelStyle()}>Página</div>
                  <select style={fieldStyle()} value={igSelectedPageId} onChange={(e) => setIgSelectedPageId(e.target.value)}>
                    <option value="">Selecione…</option>
                    {igPages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.id})
                      </option>
                    ))}
                  </select>

                  <div style={{ marginTop: 10, display: "flex", gap: 10, justifyContent: "flex-end" }}>
                    <button className="settings-primary-btn" style={{ opacity: 0.85 }} onClick={() => setIgModalOpen(false)} disabled={igConnecting}>
                      Cancelar
                    </button>
                    <button className="settings-primary-btn" onClick={finalizeInstagramWithPage} disabled={igConnecting || !igSelectedPageId}>
                      {igConnecting ? "Conectando..." : "Conectar"}
                    </button>
                  </div>
                </div>
              )}

              {!!igErr && (
                <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(248,113,113,.35)", background: "rgba(248,113,113,.10)", color: "#fecaca", fontSize: 12 }}>
                  {igErr}
                </div>
              )}
            </>
          ) : (
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button className="settings-primary-btn" style={{ opacity: 0.9 }} onClick={disconnectInstagram} disabled={igConnecting}>
                {igConnecting ? "..." : "Desconectar"}
              </button>
            </div>
          )}
        </div>
      </Modal>

      {/* WebChat Modal */}
      <Modal open={webchatOpen} title="Configurar Janela Web (Web Chat)" onClose={() => setWebchatOpen(false)}>
        {!webchatDraft ? (
          <div>Carregando...</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={labelStyle()}>Status do canal</div>
                <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={!!webchatDraft.enabled}
                    onChange={(e) => setWebchatDraft((p) => (p ? { ...p, enabled: e.target.checked } : p))}
                  />
                  <span>{webchatDraft.enabled ? "Ativo" : "Desativado"}</span>
                </label>
              </div>

              <div>
                <div style={labelStyle()}>Chave do widget (widgetKey)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input style={fieldStyle()} value={webchatDraft.widgetKey || ""} readOnly />
                  <button className="settings-primary-btn" onClick={() => copy(webchatDraft.widgetKey || "")} disabled={!webchatDraft.widgetKey}>
                    Copiar
                  </button>
                </div>

                <div style={{ marginTop: 8 }}>
                  <button className="settings-primary-btn" style={{ opacity: 0.95 }} onClick={rotateKey} disabled={saving}>
                    Rotacionar chave
                  </button>
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={labelStyle()}>Cor principal</div>
                <input
                  style={fieldStyle()}
                  value={webchatDraft.config?.primaryColor || "#34d399"}
                  onChange={(e) =>
                    setWebchatDraft((p) => (p ? { ...p, config: { ...(p.config || {}), primaryColor: e.target.value } } : p))
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
                    setWebchatDraft((p) => (p ? { ...p, config: { ...(p.config || {}), position: e.target.value } } : p))
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
                    setWebchatDraft((p) => (p ? { ...p, config: { ...(p.config || {}), buttonText: e.target.value } } : p))
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
                    setWebchatDraft((p) => (p ? { ...p, config: { ...(p.config || {}), headerTitle: e.target.value } } : p))
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
                    setWebchatDraft((p) => (p ? { ...p, config: { ...(p.config || {}), greeting: e.target.value } } : p))
                  }
                  placeholder="Olá! Como posso ajudar?"
                />
              </div>
            </div>

            <div>
              <div style={labelStyle()}>Origens permitidas (uma por linha)</div>
              <textarea
                style={{ ...fieldStyle(), minHeight: 110, resize: "vertical" }}
                value={(webchatDraft.allowedOrigins || []).join("\n")}
                onChange={(e) => setWebchatDraft((p) => (p ? { ...p, allowedOrigins: normalizeOriginLines(e.target.value) } : p))}
                placeholder={`Ex:\nhttps://cliente.gplabs.com.br\nhttps://www.gplabs.com.br`}
              />

              {isDev && (!webchatDraft.allowedOrigins || webchatDraft.allowedOrigins.length === 0) && (
                <div style={{ marginTop: 8 }}>
                  <button
                    className="settings-primary-btn"
                    style={{ opacity: 0.9 }}
                    onClick={() =>
                      setWebchatDraft((p) =>
                        p ? { ...p, allowedOrigins: ["http://localhost:5173", "http://127.0.0.1:5173"] } : p
                      )
                    }
                  >
                    Preencher origens de teste
                  </button>
                </div>
              )}
            </div>

            <div>
              <div style={labelStyle()}>
                Script de embed <span style={{ opacity: 0.75 }}>(use no site)</span>
              </div>

              <textarea
                style={{
                  ...fieldStyle(),
                  minHeight: 120,
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                  fontSize: 12
                }}
                value={snippetLoading ? "Carregando..." : embedSnippet}
                readOnly
              />

              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                <button className="settings-primary-btn" onClick={() => copy(embedSnippet)}>
                  Copiar embed
                </button>
                <button className="settings-primary-btn" style={{ opacity: 0.9 }} onClick={loadSnippet} disabled={snippetLoading}>
                  {snippetLoading ? "Atualizando..." : "Atualizar script"}
                </button>
              </div>

              {!!snippetMeta?.allowedOrigins?.length && (
                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.85 }}>
                  Origens salvas no backend: <code>{(snippetMeta.allowedOrigins || []).join(", ")}</code>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button className="settings-primary-btn" style={{ opacity: 0.85 }} onClick={() => setWebchatOpen(false)} disabled={saving}>
                Cancelar
              </button>
              <button className="settings-primary-btn" onClick={saveWebchat} disabled={saving}>
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
