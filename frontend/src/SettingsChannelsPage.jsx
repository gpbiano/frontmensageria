// frontend/src/SettingsChannelsPage.jsx
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
    // depois podemos deixar dinâmico com base na API
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
    className: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40"
  },
  not_connected: {
    label: "Não conectado",
    className: "bg-slate-700/60 text-slate-200 border border-slate-500/40"
  },
  coming_soon: {
    label: "Em breve",
    className: "bg-amber-500/10 text-amber-300 border border-amber-500/40"
  }
};

export default function SettingsChannelsPage() {
  const [selectedChannelId, setSelectedChannelId] = useState("whatsapp");

  const selectedChannel =
    CHANNELS.find((c) => c.id === selectedChannelId) || CHANNELS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      {/* Cabeçalho da página */}
      <header className="border-b border-slate-800 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Configurações
          </h1>
          <p className="text-sm text-slate-400">
            Defina os canais que irão se conectar à sua Plataforma WhatsApp GP
            Labs.
          </p>
        </div>

        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-4 py-1 text-xs text-emerald-300 border border-emerald-500/40">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          Dev · Ambiente local
        </span>
      </header>

      {/* Conteúdo principal */}
      <main className="px-8 py-6 grid grid-cols-[280px,1fr] gap-6">
        {/* Coluna esquerda – lista de canais */}
        <aside className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 space-y-3">
          <div className="mb-3">
            <h2 className="text-sm font-medium text-slate-200">
              Canais de atendimento
            </h2>
            <p className="text-xs text-slate-500">
              Selecione um canal para ver os detalhes e configurar.
            </p>
          </div>

          <div className="space-y-2">
            {CHANNELS.map((channel) => {
              const isActive = channel.id === selectedChannelId;
              const statusCfg = STATUS_CONFIG[channel.status];

              return (
                <button
                  key={channel.id}
                  type="button"
                  onClick={() => setSelectedChannelId(channel.id)}
                  className={[
                    "w-full text-left rounded-xl px-3 py-3 border flex flex-col gap-1 transition",
                    isActive
                      ? "border-emerald-500/60 bg-emerald-500/5"
                      : "border-slate-800 hover:border-slate-600 hover:bg-slate-900/80"
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {channel.name}
                    </span>
                    <span
                      className={
                        "text-[10px] px-2 py-0.5 rounded-full " +
                        statusCfg.className
                      }
                    >
                      {statusCfg.label}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 line-clamp-2">
                    {channel.description}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Coluna direita – detalhes do canal selecionado */}
        <section className="space-y-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2">
                {selectedChannel.name}
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  {selectedChannel.type}
                </span>
              </h2>
              <p className="text-sm text-slate-400 max-w-xl">
                {selectedChannel.description}
              </p>
            </div>

            {selectedChannel.id === "whatsapp" && (
              <button
                type="button"
                className="rounded-xl bg-emerald-500 text-slate-950 text-sm font-medium px-4 py-2 hover:bg-emerald-400 transition"
              >
                Reconfigurar canal
              </button>
            )}

            {selectedChannel.id !== "whatsapp" && (
              <button
                type="button"
                className="rounded-xl bg-slate-800 text-slate-100 text-sm font-medium px-4 py-2 cursor-default opacity-60"
              >
                Em breve
              </button>
            )}
          </div>

          {/* Painel específico para o canal selecionado */}
          {selectedChannel.id === "whatsapp" && <WhatsAppChannelCard />}

          {selectedChannel.id === "website" && <WebsiteChannelCard />}

          {selectedChannel.id === "messenger" && (
            <ComingSoonCard channel="Messenger" />
          )}

          {selectedChannel.id === "instagram" && (
            <ComingSoonCard channel="Instagram" />
          )}
        </section>
      </main>
    </div>
  );
}

// ====== COMPONENTES ESPECÍFICOS POR CANAL ======

function WebsiteChannelCard() {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-slate-200">
        Widget de atendimento no site
      </h3>
      <p className="text-sm text-slate-400 max-w-2xl">
        Gere um script para colar no seu site e captar conversas direto na
        Plataforma WhatsApp GP Labs.
      </p>

      <ol className="list-decimal list-inside text-sm text-slate-300 space-y-1.5">
        <li>Defina o domínio principal do seu site.</li>
        <li>
          Configure o horário de atendimento e mensagem de boas-vindas padrão.
        </li>
        <li>Copie o código gerado e cole antes de {"</body>"} no seu site.</li>
      </ol>

      <button className="mt-3 inline-flex items-center rounded-xl bg-emerald-500 text-slate-950 text-sm font-medium px-4 py-2 hover:bg-emerald-400 transition">
        Gerar script do widget
      </button>
    </div>
  );
}

/**
 * Wizard completo de configuração do WhatsApp
 * (token Meta -> contas/números -> solicitar código -> verificar & registrar)
 */
function WhatsAppChannelCard() {
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [savingToken, setSavingToken] = useState(false);
  const [requestingCode, setRequestingCode] = useState(false);
  const [verifyingPin, setVerifyingPin] = useState(false);

  const [currentStep, setCurrentStep] = useState(1);

  const [metaToken, setMetaToken] = useState("");
  const [status, setStatus] = useState(null);

  const [wabas, setWabas] = useState([]);
  const [selectedWabaId, setSelectedWabaId] = useState("");
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [selectedPhoneId, setSelectedPhoneId] = useState("");

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");

  // Carrega status inicial da integração
  useEffect(() => {
    let isMounted = true;

    async function loadStatus() {
      setLoadingStatus(true);
      setError("");
      setInfo("");
      try {
        const data = await apiFetch("/integrations/whatsapp/status");
        if (!isMounted) return;

        setStatus(data || null);

        if (data?.connected && data.phoneNumber) {
          setCurrentStep(4);
        } else if (data?.hasMetaToken) {
          setCurrentStep(2);
          await loadAccounts();
        } else {
          setCurrentStep(1);
        }
      } catch (err) {
        if (!isMounted) return;
        // Se ainda não houver status, começamos do zero
        setStatus(null);
        setCurrentStep(1);
      } finally {
        if (isMounted) setLoadingStatus(false);
      }
    }

    async function loadAccounts() {
      try {
        const data = await apiFetch("/integrations/whatsapp/accounts");
        if (!isMounted) return;

        setWabas(data.wabas || []);

        if (data.wabas && data.wabas.length > 0) {
          const first = data.wabas[0];
          setSelectedWabaId(first.id);
          setPhoneNumbers(first.phone_numbers || []);
          if (first.phone_numbers?.length > 0) {
            setSelectedPhoneId(first.phone_numbers[0].id);
          }
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err.message || "Erro ao carregar contas do WhatsApp.");
      }
    }

    loadStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  async function loadAccounts() {
    setError("");
    try {
      const data = await apiFetch("/integrations/whatsapp/accounts");
      setWabas(data.wabas || []);

      if (data.wabas && data.wabas.length > 0) {
        const first = data.wabas[0];
        setSelectedWabaId(first.id);
        setPhoneNumbers(first.phone_numbers || []);
        if (first.phone_numbers?.length > 0) {
          setSelectedPhoneId(first.phone_numbers[0].id);
        }
      }
    } catch (err) {
      setError(err.message || "Erro ao carregar contas do WhatsApp.");
    }
  }

  async function handleSaveToken(e) {
    e.preventDefault();
    if (!metaToken.trim()) {
      setError("Informe o token de acesso permanente da Meta.");
      return;
    }

    setSavingToken(true);
    setError("");
    setInfo("");

    try {
      const data = await apiFetch("/integrations/whatsapp/meta-token/test", {
        method: "POST",
        body: JSON.stringify({ token: metaToken })
      });

      setInfo("Token validado e salvo com sucesso.");
      setStatus((prev) => ({
        ...(prev || {}),
        hasMetaToken: true,
        businessName: data.businessName || prev?.businessName
      }));

      setCurrentStep(2);
      await loadAccounts();
    } catch (err) {
      setError(err.message || "Não foi possível validar o token.");
    } finally {
      setSavingToken(false);
    }
  }

  function handleChangeWaba(wabaId) {
    setSelectedWabaId(wabaId);
    const w = wabas.find((wb) => wb.id === wabaId);
    const phones = w?.phone_numbers || [];
    setPhoneNumbers(phones);
    setSelectedPhoneId(phones[0]?.id || "");
  }

  async function handleRequestCode(e) {
    e.preventDefault();
    if (!selectedPhoneId) {
      setError("Selecione um número de telefone.");
      return;
    }

    setRequestingCode(true);
    setError("");
    setInfo("");

    try {
      await apiFetch(
        `/integrations/whatsapp/phone/${selectedPhoneId}/request-code`,
        {
          method: "POST",
          body: JSON.stringify({
            code_method: "SMS",
            language: "pt_BR"
          })
        }
      );

      setInfo("Código enviado por SMS. Digite o PIN recebido para continuar.");
      setCurrentStep(3);
    } catch (err) {
      setError(err.message || "Erro ao solicitar código.");
    } finally {
      setRequestingCode(false);
    }
  }

  async function handleVerifyAndRegister(e) {
    e.preventDefault();
    if (!selectedPhoneId) {
      setError("Selecione um número de telefone.");
      return;
    }
    if (!pin.trim()) {
      setError("Informe o PIN recebido por SMS.");
      return;
    }

    setVerifyingPin(true);
    setError("");
    setInfo("");

    try {
      const data = await apiFetch(
        `/integrations/whatsapp/phone/${selectedPhoneId}/verify-and-register`,
        {
          method: "POST",
          body: JSON.stringify({ pin: pin.trim() })
        }
      );

      setStatus({
        connected: true,
        phoneNumber: data.phoneNumber,
        phoneNumberId: selectedPhoneId,
        wabaId: data.wabaId,
        wabaName: data.wabaName,
        webhookUrl: data.webhookUrl,
        verifiedName: data.verifiedName
      });

      setInfo("Número verificado e registrado com sucesso!");
      setCurrentStep(4);
    } catch (err) {
      setError(err.message || "Erro ao verificar e registrar o número.");
    } finally {
      setVerifyingPin(false);
    }
  }

  const selectedWaba = wabas.find((w) => w.id === selectedWabaId);
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedPhoneId);

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Integração com WhatsApp Business API
          </h3>
          <p className="text-sm text-slate-400 max-w-3xl">
            Siga as etapas abaixo para conectar sua conta oficial do WhatsApp
            à Plataforma GP Labs. É basicamente o fluxo que você fez no
            Postman, só que guiado pela interface.
          </p>
        </div>

        {status?.connected && selectedPhone && (
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] text-emerald-300 border border-emerald-500/40">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            Número conectado: {selectedPhone.display_phone_number}
          </span>
        )}
      </div>

      {/* Indicador de etapas */}
      <div className="flex items-center gap-4 text-xs text-slate-400">
        <StepBadge step={1} active={currentStep === 1} done={currentStep > 1}>
          Token Meta
        </StepBadge>
        <StepBadge step={2} active={currentStep === 2} done={currentStep > 2}>
          Conta & número
        </StepBadge>
        <StepBadge step={3} active={currentStep === 3} done={currentStep > 3}>
          PIN
        </StepBadge>
        <StepBadge step={4} active={currentStep === 4} done={status?.connected}>
          Conectado
        </StepBadge>
      </div>

      {loadingStatus && (
        <p className="text-sm text-slate-400">Carregando status...</p>
      )}

      {!loadingStatus && (
        <>
          {error && (
            <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              {error}
            </div>
          )}
          {info && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
              {info}
            </div>
          )}

          {/* STEP 1 – TOKEN META */}
          {currentStep === 1 && (
            <form
              onSubmit={handleSaveToken}
              className="mt-2 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <h4 className="text-sm font-medium text-slate-200">
                1. Informe o token permanente da Meta
              </h4>
              <p className="text-xs text-slate-400">
                Use um token de acesso permanente com as permissões{" "}
                <code className="bg-slate-900 px-1 py-0.5 rounded">
                  whatsapp_business_messaging
                </code>{" "}
                e{" "}
                <code className="bg-slate-900 px-1 py-0.5 rounded">
                  whatsapp_business_management
                </code>
                .
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-slate-300">Token de acesso</span>
                <textarea
                  rows={3}
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="EAAG..."
                />
              </label>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={savingToken}
                  className="inline-flex items-center rounded-xl bg-emerald-500 text-slate-950 text-xs font-medium px-4 py-2 hover:bg-emerald-400 transition disabled:opacity-60"
                >
                  {savingToken ? "Validando token..." : "Testar e salvar"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2 – ESCOLHER CONTA E NÚMERO */}
          {currentStep >= 2 && (
            <form
              onSubmit={handleRequestCode}
              className="mt-2 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <h4 className="text-sm font-medium text-slate-200">
                2. Escolha a conta e o número
              </h4>

              {wabas.length === 0 ? (
                <p className="text-xs text-slate-400">
                  Não encontramos contas do WhatsApp Business para este token.
                  Confirme se o token está correto e se a WABA já foi criada.
                </p>
              ) : (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-300">
                      Conta do WhatsApp Business (WABA)
                    </span>
                    <select
                      value={selectedWabaId}
                      onChange={(e) => handleChangeWaba(e.target.value)}
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      {wabas.map((waba) => (
                        <option key={waba.id} value={waba.id}>
                          {waba.name || waba.id}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-slate-300">
                      Número de telefone
                    </span>
                    <select
                      value={selectedPhoneId}
                      onChange={(e) => setSelectedPhoneId(e.target.value)}
                      className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-emerald-500 focus:outline-none"
                    >
                      {phoneNumbers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.display_phone_number} – {p.verified_name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedPhone && (
                    <p className="text-[11px] text-slate-400">
                      Status atual:{" "}
                      <span className="font-medium text-slate-200">
                        {selectedPhone.status || "DESCONHECIDO"}
                      </span>
                    </p>
                  )}

                  {currentStep === 2 && (
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={requestingCode || !selectedPhoneId}
                        className="inline-flex items-center rounded-xl bg-emerald-500 text-slate-950 text-xs font-medium px-4 py-2 hover:bg-emerald-400 transition disabled:opacity-60"
                      >
                        {requestingCode
                          ? "Solicitando código..."
                          : "Solicitar código por SMS"}
                      </button>
                    </div>
                  )}
                </>
              )}
            </form>
          )}

          {/* STEP 3 – PIN */}
          {currentStep === 3 && (
            <form
              onSubmit={handleVerifyAndRegister}
              className="mt-2 space-y-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <h4 className="text-sm font-medium text-slate-200">
                3. Digite o PIN recebido
              </h4>
              <p className="text-xs text-slate-400">
                Enviamos um código de verificação para o número selecionado.
                Informe o <strong>PIN de 6 dígitos</strong> abaixo.
              </p>

              <label className="flex flex-col gap-1 max-w-xs">
                <span className="text-xs text-slate-300">PIN</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  placeholder="123456"
                  className="rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 tracking-widest text-center focus:border-emerald-500 focus:outline-none"
                />
              </label>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={verifyingPin}
                  className="inline-flex items-center rounded-xl bg-emerald-500 text-slate-950 text-xs font-medium px-4 py-2 hover:bg-emerald-400 transition disabled:opacity-60"
                >
                  {verifyingPin
                    ? "Verificando e registrando..."
                    : "Verificar e registrar número"}
                </button>
              </div>
            </form>
          )}

          {/* STEP 4 – CONECTADO */}
          {currentStep === 4 && status?.connected && (
            <div className="mt-2 space-y-3 rounded-2xl border border-emerald-600/50 bg-emerald-500/5 p-4">
              <h4 className="text-sm font-medium text-emerald-200 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-slate-950 text-xs">
                  ✓
                </span>
                4. Número conectado
              </h4>
              <p className="text-xs text-emerald-100">
                Seu número está pronto para uso na Plataforma GP Labs. Todas as
                mensagens recebidas serão encaminhadas para{" "}
                <code className="bg-emerald-900/60 px-1 py-0.5 rounded">
                  /webhook/whatsapp
                </code>
                .
              </p>
              <ul className="text-xs text-emerald-100 space-y-1">
                <li>
                  <span className="font-semibold">Número:</span>{" "}
                  {status.phoneNumber}
                </li>
                <li>
                  <span className="font-semibold">Verified name:</span>{" "}
                  {status.verifiedName}
                </li>
                <li>
                  <span className="font-semibold">Phone number ID:</span>{" "}
                  {status.phoneNumberId}
                </li>
                <li>
                  <span className="font-semibold">WABA:</span>{" "}
                  {status.wabaName} ({status.wabaId})
                </li>
                <li>
                  <span className="font-semibold">Webhook:</span>{" "}
                  {status.webhookUrl ||
                    "https://api.gplabs.com.br/webhook/whatsapp"}
                </li>
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StepBadge({ step, active, done, children }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={[
          "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-semibold border",
          done
            ? "bg-emerald-500 text-slate-950 border-emerald-500"
            : active
            ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/70"
            : "bg-slate-900 text-slate-400 border-slate-700"
        ].join(" ")}
      >
        {done ? "✓" : step}
      </div>
      <span
        className={
          "text-[11px] " +
          (active || done ? "text-slate-200" : "text-slate-500")
        }
      >
        {children}
      </span>
    </div>
  );
}

function ComingSoonCard({ channel }) {
  return (
    <div className="bg-slate-900/60 border border-dashed border-amber-500/40 rounded-2xl p-5 space-y-3">
      <h3 className="text-sm font-semibold text-slate-200">
        {channel} – em breve
      </h3>
      <p className="text-sm text-slate-400 max-w-2xl">
        Este canal ainda está em desenvolvimento dentro da GP Labs. Em breve
        você poderá conectar o {channel} e receber todas as mensagens na mesma
        caixa de entrada omnichannel.
      </p>
      <p className="text-xs text-slate-500">
        Caso queira dar prioridade a este canal, fale com o time GP Labs para
        entrar no programa de early adopters.
      </p>
    </div>
  );
}
