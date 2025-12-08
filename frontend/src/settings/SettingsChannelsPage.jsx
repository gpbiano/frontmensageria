// frontend/src/settings/SettingsChannelsPage.jsx
import React from "react";

export default function SettingsChannelsPage() {
  return (
    <div className="settings-page">
      {/* Título principal */}
      <h1 className="settings-title">Configurações</h1>
      <p className="settings-subtitle">
        Defina os canais que irão se conectar à sua Plataforma WhatsApp GP Labs.
      </p>

      <div className="settings-env-info">
        <span>Dev · Ambiente local</span>
      </div>

      {/* Seção: Canais de atendimento */}
      <section className="settings-section">
        <h2 className="settings-section-title">Canais de atendimento</h2>
        <p className="settings-section-description">
          Selecione um canal para ver os detalhes e configurar.
        </p>

        <div className="settings-channels-grid">
          {/* Canal: Web Site */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">Web Site</span>
              <span className="status-pill status-pill-off">
                Não conectado
              </span>
            </div>
            <p className="settings-channel-description">
              Conecte o widget de atendimento GP Labs ao seu site.
            </p>
          </div>

          {/* Canal: WhatsApp */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">WhatsApp</span>
              <span className="status-pill status-pill-on">Conectado</span>
            </div>
            <p className="settings-channel-description">
              Envio e recebimento de mensagens pela API oficial do WhatsApp
              Business.
            </p>
          </div>

          {/* Canal: Messenger */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">Messenger</span>
              <span className="status-pill status-pill-soon">Em breve</span>
            </div>
            <p className="settings-channel-description">
              Integração com a caixa de mensagens da sua página do Facebook.
            </p>
          </div>

          {/* Canal: Instagram */}
          <div className="settings-channel-card">
            <div className="settings-channel-header">
              <span className="settings-channel-title">Instagram</span>
              <span className="status-pill status-pill-soon">Em breve</span>
            </div>
            <p className="settings-channel-description">
              Mensagens diretas (DM) do Instagram integradas no painel de
              atendimento.
            </p>
          </div>
        </div>
      </section>

      {/* Seção: WhatsApp Business API */}
      <section className="settings-section">
        <h2 className="settings-section-title">WhatsApp Business API</h2>
        <p className="settings-section-description">
          Envio e recebimento de mensagens pela API oficial do WhatsApp
          Business.
        </p>

        <button className="settings-primary-btn">Reconfigurar canal</button>

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
    </div>
  );
}
