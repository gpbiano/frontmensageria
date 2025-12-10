// frontend/src/components/GlobalHeader.jsx
import { useState, useRef, useEffect } from "react";

export default function GlobalHeader({ onLogout }) {
  const user = {
    name: "Genivaldo Peres",
    company: "GP Labs",
    role: "Administrador"
  };

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleToggleMenu() {
    setIsMenuOpen((prev) => !prev);
  }

  function handleLogoutClick() {
    setIsMenuOpen(false);
    if (onLogout) onLogout();
  }

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
          <button className="ghost-btn">💡 Enviar sugestão</button>

          {/* MENU DO USUÁRIO */}
          <div className="user-menu" ref={menuRef}>
            {/* "Pílula" clicável */}
            <button
              type="button"
              className="user-pill user-menu-trigger"
              onClick={handleToggleMenu}
            >
              <div className="user-avatar">{user.name.charAt(0)}</div>
              <div className="user-meta">
                <div className="user-name">{user.name}</div>
                <div className="user-company">{user.company}</div>
              </div>
            </button>

            {/* DROPDOWN */}
            <div className={`user-dropdown ${isMenuOpen ? "open" : ""}`}>
              <button className="dropdown-item">👤 Meu perfil</button>
              <button
                className="dropdown-item logout"
                type="button"
                onClick={handleLogoutClick}
              >
                🚪 Sair
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
