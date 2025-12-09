// frontend/src/components/GlobalHeader.jsx

export default function GlobalHeader({ onLogout }) {
  const user = {
    name: "Genivaldo Peres",
    company: "GP Labs",
    role: "Administrador"
  };

  return (
    <header className="topbar">
      <div className="topbar-accent"></div>

      <div className="topbar-inner">
        {/* ESQUERDA */}
        <div className="topbar-left">
          <div className="topbar-logo">
            <img src="/gp-labs-logo.png" alt="GP Labs" />
          </div>

          <div className="topbar-title-block">
            <div className="topbar-app-title">GP Labs Platform</div>
            <div className="topbar-app-subtitle">
              Central de campanhas, atendimento e chatbot
            </div>
          </div>
        </div>

        {/* DIREITA */}
        <div className="topbar-right">

          {/* Botão para sugestões */}
          <button className="ghost-btn">
            💡 Enviar sugestão
          </button>

          {/* MENU DO USUÁRIO */}
          <div className="user-menu">
            <div className="user-pill user-menu-trigger">
              <div className="user-avatar">
                {user.name.charAt(0)}
              </div>
              <div className="user-meta">
                <div className="user-name">{user.name}</div>
                <div className="user-company">{user.company}</div>
              </div>
            </div>

            {/* DROPDOWN */}
            <div className="user-dropdown">
              <button className="dropdown-item">👤 Meu perfil</button>
              <button className="dropdown-item logout" onClick={onLogout}>
                🚪 Sair
              </button>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}
