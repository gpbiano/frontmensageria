// frontend/src/App.jsx
import { useEffect, useState } from "react";
import ChatHistoryPage from "./ChatHistoryPage";
import CampaignsPage from "./outbound/CampaignsPage";
import LoginPage from "./LoginPage";
import SettingsChannelsPage from "./settings/SettingsChannelsPage.jsx";

import "./App.css";
import "./chat-history.css";

const AUTH_KEY = "gpLabsAuthToken";

export default function App() {
  const [activeSection, setActiveSection] = useState("inbound");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Quando a aplicação carrega, vê se já tem token salvo
  useEffect(() => {
    const token = localStorage.getItem(AUTH_KEY);
    if (token) {
      console.log("🔐 Token encontrado, autenticando automaticamente");
      setIsAuthenticated(true);
    }
  }, []);

  function handleLogin(data) {
    console.log("🔥 Login confirmado no App.jsx:", data);

    if (data?.token) {
      localStorage.setItem(AUTH_KEY, data.token);
      setIsAuthenticated(true);
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
  }

  function renderContent() {
    switch (activeSection) {
      case "outbound":
        return <CampaignsPage />;
      case "settings":
        return <SettingsChannelsPage />;
      case "inbound":
      default:
        // Atendimento (Chats)
        return <ChatHistoryPage />;
    }
  }

  // Estado não autenticado: só mostra login
  if (!isAuthenticated) {
    return (
      <div className="app-root dark">
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app-root dark">
      {/* HEADER GLOBAL */}
      <header className="app-header">
        <div className="logo-area">
          <div className="logo-mark">GP</div>
          <div className="logo-text">
            <span className="logo-main">LABS</span>
            <span className="logo-sub">Plataforma WhatsApp</span>
          </div>
        </div>

        <nav className="app-nav">
          <button
            className={
              "nav-item " +
              (activeSection === "inbound" ? "nav-item--active" : "")
            }
            onClick={() => setActiveSection("inbound")}
          >
            Atendimento
          </button>
          <button
            className={
              "nav-item " +
              (activeSection === "outbound" ? "nav-item--active" : "")
            }
            onClick={() => setActiveSection("outbound")}
          >
            Campanhas
          </button>
          <button
            className={
              "nav-item " +
              (activeSection === "settings" ? "nav-item--active" : "")
            }
            onClick={() => setActiveSection("settings")}
          >
            Configurações
          </button>
        </nav>

        <div className="app-header-right">
          <span className="env-pill">Dev · Local</span>
          <span className="version-pill">v1.0.3</span>
          <span className="user-label">Olá, Administrador</span>
          <button className="logout-button" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      {/* CONTEÚDO PRINCIPAL */}
      <main className="app-main">{renderContent()}</main>
    </div>
  );
}

