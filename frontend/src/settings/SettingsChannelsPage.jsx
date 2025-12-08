// frontend/src/settings/SettingsChannelsPage.jsx
import { useState, useEffect } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

function apiFetch(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  }).then(async (res) => {
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        data?.error || data?.message || `Erro HTTP ${res.status}`;
      throw new Error(message);
    }
    return data;
  });
}

const CHANNELS = [
  {
    id: "website",
    name: "Web Site",
    type: "WEB",
    description: "Conecte o widget de atendimento GP Labs ao seu site.",
    status: "not_connected"
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    type: "WHATSAPP",
    description:
      "Envio e recebimento de mensagens pela API oficial do WhatsApp Business.",
    status: "connected"
  },
  {
    id: "messenger",
    name: "Messenger",
    type: "MESSENGER",
    description:
      "Integração com a caixa de mensagens da sua página do Facebook.",
    status: "coming_soon"
  },
  {
    id: "instagram",
    name: "Instagram",
    type: "INSTAGRAM",
    description:
      "Mensagens diretas (DM) do Instagram integradas no painel de atendimento.",
    status: "coming_soon"
  }
];

const STATUS_CONFIG = {
  connected: {
    label: "Conectado",
    className:
      "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
  },
  not_connected: {
    label: "Não conectado",
    className:
      "bg-slate-700/60 text-slate-200 border border-slate-500/40"
  },
  coming_soon: {
    label: "Em breve",
    className:
      "bg-amber-500/10 text-amber-300 border border-amber-500/40"
  }
};

export default function SettingsChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState("whatsapp");
  const selectedChannel =
    CHANNELS.find((c) => c.id === selectedChannelId) || CHANNELS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">

      {/* TÍTULO */}
      <div className="px-8 py-6 border-b border-slate-800">
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-slate-400">
          Defina os canais que irão se conectar à sua Plataforma WhatsApp GP Labs.
        </p>
        <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1 text-xs text-emerald-300 border border-emerald-500/40">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Dev · Ambiente local
        </div>
      </div>

      {/* LAYOUT PRINCIPAL */}
      <main className="px-8 py-6 grid grid-cols-[300px,1fr] gap-6">

        {/* MENU LATERAL */}
        <aside className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-4">
          <h2 className="text-sm font-medium">Canais de atendimento</h2>
          <p className="text-xs text-slate-500 -mt-2 mb-4">
            Selecione um canal para ver os detalhes e configurar.
          </p>

          <div className="space-y-2">
            {CHANNELS.map((channel) => {
              const isActive = channel.id === selectedChannelId;
              const statusCfg = STATUS_CONFIG[channel.status];

              return (
                <button
                  key={channel.id}
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={[
                    "w-full text-left px-4 py-3 rounded-xl border transition flex flex-col",
                    isActive
                      ? "bg-emerald-500/10 border-emerald-600"
                      : "bg-slate-900/50 border-slate-700 hover:bg-slate-900"
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{channel.name}</span>
                    <span
                      className={
                        "text-[10px] px-2 py-1 rounded-full " +
                        statusCfg.className
                      }
                    >
                      {statusCfg.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {channel.description}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* PAINEL DIREITO */}
        <section className="space-y-6">

          {/* HEADER DO CANAL */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-xl font-semibold flex items-center gap-3">
              {selectedChannel.name}
              <span className="text-[11px] uppercase tracking-wide text-slate-500">
                {selectedChannel.type}
              </span>
            </h2>
            <p className="text-sm text-slate-400 mt-1">{selectedChannel.description}</p>

            {/* BOTÃO PRINCIPAL */}
            {selectedChannel.id === "whatsapp" ? (
              <button className="mt-4 rounded-xl bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-medium hover:bg-emerald-400 transition">
                Reconfigurar canal
              </button>
            ) : (
              <button className="mt-4 rounded-xl bg-slate-700 text-slate-400 px-4 py-2 text-sm font-medium cursor-not-allowed">
                Em breve
              </button>
            )}
          </div>

          {/* CONTEÚDO ESPECÍFICO */}
          {selectedChannel.id === "whatsapp" && <WhatsAppChannelCard />}
          {selectedChannel.id === "website" && <WebsiteChannelCard />}
          {selectedChannel.id === "instagram" && <ComingSoonCard channel="Instagram" />}
          {selectedChannel.id === "messenger" && <ComingSoonCard channel="Messenger" />}
        </section>

      </main>
    </div>
  );
}

function WebsiteChannelCard() {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-2">Widget do Site</h3>
      <p className="text-sm text-slate-400 max-w-xl">
        Gere um script para inserir no seu site e coletar conversas diretamente na plataforma.
      </p>

      <ol className="list-decimal ml-6 mt-4 text-sm space-y-1">
        <li>Informe o domínio do seu site.</li>
        <li>Personalize a saudação e horários de atendimento.</li>
        <li>Cole o script no final da tag &lt;/body&gt;.</li>
      </ol>

      <button className="mt-4 rounded-xl bg-emerald-500 text-slate-950 px-4 py-2 text-sm font-medium hover:bg-emerald-400 transition">
        Gerar script
      </button>
    </div>
  );
}

function ComingSoonCard({ channel }) {
  return (
    <div className="bg-slate-900/60 border border-amber-500/40 rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-amber-300 mb-2">
        {channel} – em breve
      </h3>
      <p className="text-sm text-slate-400">
        Este canal ainda está sendo implementado pela equipe GP Labs.
      </p>
    </div>
  );
}

/* ======== WIZARD WHATSAPP – COMPLETO ======== */

function WhatsAppChannelCard() {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
      <h3 className="text-lg font-semibold mb-2">Integração com WhatsApp Business API</h3>
      <p className="text-sm text-slate-400 max-w-xl">
        Configure o token permanente, selecione a conta e valide seu número de WhatsApp Business.
      </p>

      <div className="mt-4 text-slate-300 text-sm">
        <p><strong>1.</strong> Token Meta</p>
        <p><strong>2.</strong> Conta & número</p>
        <p><strong>3.</strong> PIN</p>
        <p><strong>4.</strong> Conectado</p>
      </div>

      <div className="mt-6">
        <p className="text-xs text-slate-400 mb-2">Token permanente da Meta</p>
        <textarea
          rows={3}
          placeholder="EAAG..."
          className="w-full rounded-xl bg-slate-950 border border-slate-800 px-3 py-2 text-sm focus:border-emerald-500 outline-none"
        />
      </div>
    </div>
  );
}