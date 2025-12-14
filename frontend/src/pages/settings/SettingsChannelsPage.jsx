// frontend/src/settings/ChannelsSettingsPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../../styles/settings-channels.css";

import {
  fetchChannels,
  updateWebchatChannel,
  rotateWebchatKey
} from "../../api";

// Metadados de exibição (nome/descrição) — o backend não precisa enviar isso
const CHANNEL_META = {
  webchat: {
    id: "webchat",
    name: "Janela Web (Web Chat)",
    description:
      "Widget de atendimento para seu site. Configure origens permitidas e personalização."
  },
  whatsapp: {
    id: "whatsapp",
    name: "WhatsApp",
    description:
      "Envio e recebimento de mensagens pela API oficial do WhatsApp Business."
  },
  messenger: {
    id: "messenger",
    name: "Messenger",
    description: "Integração com a caixa de mensagens da sua página do Facebook."
  },
  instagram: {
    id: "instagram",
    name: "Instagram",
    description:
      "Mensagens diretas (DM) do Instagram integradas no painel de atendimento."
  }
};

export default function ChannelsSettingsPage() {
  const [channelsState, setChannelsState] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Converte objeto -> lista para renderizar cards com .map
  const channelsList = useMemo(() => {
    const webchat = channelsState?.webchat || {};
    const whatsapp = channelsState?.whatsapp || {};
    const messenger = channelsState?.messenger || {};
    const instagram = channelsState?.instagram || {};

    return [
      {
        ...CHANNEL_META.webchat,
        enabled: !!webchat.enabled,
        status: webchat.status || "disconnected",
        widgetKey: webchat.widgetKey || "",
        allowedOrigins: Array.isArray(webchat.allowedOrigins)
          ? webchat.allowedOrigins
          : [],
        config: webchat.config || {}
      },
      {
        ...CHANNEL_META.whatsapp,
        enabled: !!whatsapp.enabled,
        status: whatsapp.status || "connected"
      },
      {
        ...CHANNEL_META.messenger,
        enabled: !!messenger.enabled,
        status: messenger.status || "soon"
      },
      {
        ...CHANNEL_META.instagram,
        enabled: !!instagram.enabled,
        status: instagram.status || "soon"
      }
    ];
  }, [channelsState]);

  const webchat = useMemo(
    () => channelsList.find((c) => c.id === "webchat"),
    [channelsList]
  );

  // ============================
  // LOAD
  // ============================
  async function loadChannels() {
    try {
      setLoading(true);
      setError("");
      const state = await fetchChannels(); // <- retorna { webchat, whatsapp, ... }
      setChannelsState(state || {});
    } catch (e) {
      console.error(e);
      setError(e?.message || "Erro ao carregar canais.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadChannels();
  }, []);

  // ============================
  // TOGGLE CHANNEL
  // ============================
  async function toggleChannel(channel, enabled) {
    // hoje só webchat é configurável (os outros ficam "soon" / conectados por sistema)
    if (channel.id !== "webchat") {
      setChannelsState((prev) => ({
        ...(prev || {}),
        [channel.id]: { ...(prev?.[channel.id] || {}), enabled }
      }));
      return;
    }

    try {
      setSaving(true);
      const res = await updateWebchatChannel({ enabled });

      setChannelsState((prev) => ({
        ...(prev || {}),
        webchat: {
          ...(prev?.webchat || {}),
          ...(res?.webchat || {})
        }
      }));
    } catch (e) {
      console.error(e);
      alert(e?.message || "Erro ao atualizar WebChat");
    } finally {
      setSaving(false);
    }
  }

  // ============================
  // UPDATE WEBCHAT CONFIG
  // ============================
  async function updateWebchatConfig(patch) {
    try {
      setSaving(true);

      const nextConfig = {
        ...(webchat?.config || {}),
        ...(patch || {})
      };

      const res = await updateWebchatChannel({ config: nextConfig });

      setChannelsState((prev) => ({
        ...(prev || {}),
        webchat: {
          ...(prev?.webchat || {}),
          ...(res?.webchat || {})
        }
      }));
    } catch (e) {
      console.error(e);
      alert(e?.message || "Erro ao salvar configuração");
    } finally {
      setSaving(false);
    }
  }

  async function rotateKey() {
    const ok = confirm(
      "Rotacionar a widgetKey invalida os scripts antigos. Tem certeza?"
    );
    if (!ok) return;

    try {
      setSaving(true);
      await rotateWebchatKey();
      await loadChannels();
    } catch (e) {
      console.error(e);
      alert(e?.message || "Erro ao rotacionar chave");
    } finally {
      setSaving(false);
    }
  }

  // ============================
  // RENDER
  // ============================
  return (
    <div className="settings-page">
      <header className="settings-header">
        <h1>Canais</h1>
        <p>Gerencie os canais de atendimento e integrações.</p>
      </header>

      {loading && <p>Carregando canais...</p>}
      {error && <p className="error">{error}</p>}

      {!loading &&
        channelsList.map((channel) => (
          <div key={channel.id} className="channel-card">
            <div className="channel-header">
              <div>
                <h2>{channel.name}</h2>
                <p>{channel.description}</p>
              </div>

              <label className="switch">
                <input
                  type="checkbox"
                  checked={!!channel.enabled}
                  onChange={(e) => toggleChannel(channel, e.target.checked)}
                  disabled={saving}
                />
                <span className="slider" />
              </label>
            </div>

            {/* ================= WEBCHAT CONFIG ================= */}
            {channel.id === "webchat" && channel.enabled && (
              <div className="channel-body">
                <div className="form-row">
                  <label>Título</label>
                  <input
                    value={channel.config?.title || ""}
                    onChange={(e) =>
                      updateWebchatConfig({ title: e.target.value })
                    }
                  />
                </div>

                <div className="form-row">
                  <label>Texto do botão</label>
                  <input
                    value={channel.config?.buttonText || ""}
                    onChange={(e) =>
                      updateWebchatConfig({ buttonText: e.target.value })
                    }
                  />
                </div>

                <div className="form-row">
                  <label>Mensagem inicial</label>
                  <textarea
                    value={channel.config?.greeting || ""}
                    onChange={(e) =>
                      updateWebchatConfig({ greeting: e.target.value })
                    }
                  />
                </div>

                <div className="form-row">
                  <label>Posição</label>
                  <select
                    value={channel.config?.position || "right"}
                    onChange={(e) =>
                      updateWebchatConfig({ position: e.target.value })
                    }
                  >
                    <option value="right">Direita</option>
                    <option value="left">Esquerda</option>
                  </select>
                </div>

                <div className="form-row">
                  <label>Cor principal</label>
                  <input
                    type="color"
                    value={channel.config?.color || "#34d399"}
                    onChange={(e) =>
                      updateWebchatConfig({ color: e.target.value })
                    }
                  />
                </div>

                <div className="form-row">
                  <label>Widget Key</label>
                  <div className="inline">
                    <input readOnly value={channel.widgetKey || ""} />
                    <button
                      className="danger"
                      onClick={rotateKey}
                      disabled={saving}
                    >
                      Rotacionar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ================= FUTUROS CANAIS ================= */}
            {channel.id !== "webchat" && (
              <div className="channel-body muted">
                <p>Status: {channel.status}</p>
                <p>Configuração avançada em breve.</p>
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
