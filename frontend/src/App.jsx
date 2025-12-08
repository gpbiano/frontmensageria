// frontend/src/App.jsx
import { useEffect, useState } from "react";
import ChatHistoryPage from "./ChatHistoryPage";
import CampaignsPage from "./outbound/CampaignsPage";
import SettingsChannelsPage from "./settings/SettingsChannelsPage.jsx";
import ChatbotPage from "./chatbot/ChatbotPage.jsx";
import LoginPage from "./LoginPage";

import "./App.css";
import "./chat-history.css";
import "./campaigns.css";
import "./chatbot.css";

const AUTH_KEY = "gpLabsAuthToken";

export default function App() {
  const [activeSection, setActiveSection] = useState("inbound"); // inbound | outbound | chatbot | settings
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Quando a aplicação carrega, verifica se já existe token salvo
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
    }

    setIsAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
  }

  const isDev = import.meta.env.MODE === "development";

  function renderContent() {
    if (activeSection === "inbound") {
      return <ChatHistoryPage />;
    }
    if (activeSection === "outbound") {
      return <CampaignsPage />;
    }
    if (activeSection === "chatbot") {
      return <ChatbotPage />;
    }
    if (activeSection === "settings") {
      return <SettingsChannelsPage />;
    }
    return <ChatHistoryPage />;
  }

  if (!isAuthenticated) {
    return (
      <div className="app-root">
        <LoginPage onLogin={handleLogin} />
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="app-shell">
        {/* SIDEBAR ESQUERDA */}
        <aside className="sidebar">
          <div className="sidebar-header">
            <div className="sidebar-logo-wrapper">
              {/* Logo vindo da pasta /public */}
              <img
                src="/gp-labs-logo.png"
                alt="GP Labs Logo"
                className="sidebar-logo-img"
              />
            </div>
            <div className="sidebar-brand-text">
              <span className="sidebar-brand-main">L A B S</span>
              <span className="sidebar-brand-sub">Plataforma WhatsApp</span>
            </div>
          </div>

          <nav className="sidebar-nav">
            <button
              className={
                activeSection === "inbound"
                  ? "sidebar-nav-item active"
                  : "sidebar-nav-item"
              }
              onClick={() => setActiveSection("inbound")}
            >
              Atendimento
            </button>

            <button
              className={
                activeSection === "outbound"
                  ? "sidebar-nav-item active"
                  : "sidebar-nav-item"
              }
              onClick={() => setActiveSection("outbound")}
            >
              Campanhas
            </button>

            <button
              className={
                activeSection === "chatbot"
                  ? "sidebar-nav-item active"
                  : "sidebar-nav-item"
              }
              onClick={() => setActiveSection("chatbot")}
            >
              Chatbot
            </button>

            <button
              className={
                activeSection === "settings"
                  ? "sidebar-nav-item active"
                  : "sidebar-nav-item"
              }
              onClick={() => setActiveSection("settings")}
            >
              Configurações
            </button>
          </nav>
        </aside>

        {/* ÁREA PRINCIPAL */}
        <main className="main-area">
          {/* Topbar */}
          <header className="topbar">
            <div className="topbar-left">
              {isDev && (
                <span className="env-pill env-pill-dev">Dev · Local</span>
              )}
              <span className="env-pill env-pill-version">v1.0.3</span>
            </div>

            <div className="topbar-right">
              <span className="topbar-user">Olá, Administrador</span>
              <button className="topbar-logout-btn" onClick={handleLogout}>
                Sair
              </button>
            </div>
          </header>

          {/* Conteúdo */}
          <section className="main-content">{renderContent()}</section>
        </main>
      </div>
    </div>
  );
}
