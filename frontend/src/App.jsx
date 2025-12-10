// frontend/src/App.jsx
import { useEffect, useState } from "react";

import ChatHistoryPage from "./ChatHistoryPage.jsx";

// OUTBOUND
import CampaignsPage from "./outbound/CampaignsPage.jsx";
import TemplatesPage from "./outbound/TemplatesPage.jsx";
import MediaLibrary from "./outbound/MediaLibrary.jsx";
import CampaignReport from "./outbound/CampaignReport.jsx";
import CampaignsAnalyticsPage from "./outbound/CampaignsAnalyticsPage.jsx";
import NumbersPage from "./outbound/NumbersPage.jsx";
import BlacklistPage from "./outbound/BlacklistPage.jsx";
import FilesPage from "./outbound/FilesPage.jsx";

// CHATBOT
import ChatbotPage from "./chatbot/ChatbotPage.jsx";

// SETTINGS
import SettingsChannelsPage from "./settings/SettingsChannelsPage.jsx";

// AUTH
import LoginPage from "./LoginPage.jsx";

// LAYOUT
import GlobalHeader from "./components/GlobalHeader.jsx";

// CSS GLOBAL
import "./App.css";
import "./chat-history.css";
import "./campaigns.css";
import "./chatbot.css";

const AUTH_KEY = "gpLabsAuthToken";

export default function App() {
  const [activeSection, setActiveSection] = useState("inbound");
  const [activeCampaignTab, setActiveCampaignTab] = useState("analytics");
  const [campaignsOpen, setCampaignsOpen] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // Auto login se tiver token salvo
  useEffect(() => {
    const token = localStorage.getItem(AUTH_KEY);
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  function handleLogin(data) {
    if (data?.token) {
      localStorage.setItem(AUTH_KEY, data.token);
    }
    setIsAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("gpLabsUser");
    localStorage.removeItem("gpLabsRememberMe");
    setIsAuthenticated(false);
  }

  // Navegação principal
  function selectInbound() {
    setActiveSection("inbound");
  }

  function selectChatbot() {
    setActiveSection("chatbot");
  }

  function toggleCampaigns() {
    setCampaignsOpen((prev) => !prev);
    setActiveSection("campaigns");
  }

  function selectCampaignTab(tab) {
    setActiveSection("campaigns");
    setActiveCampaignTab(tab);
  }

  function selectSettings() {
    setActiveSection("settings");
  }

  // Se não estiver logado, mostra só a tela de login
  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      {/* HEADER GLOBAL – topo inteiro */}
      <GlobalHeader onLogout={handleLogout} />

      {/* LAYOUT PRINCIPAL: SIDEBAR + CONTEÚDO */}
      <div className="app-main">
        {/* SIDEBAR */}
        <aside className="sidebar">
          <nav className="sidebar-menu">
            {/* Atendimento */}
            <button
              className={
                "sidebar-item" + (activeSection === "inbound" ? " active" : "")
              }
              onClick={selectInbound}
            >
              <span className="sidebar-item-label">Atendimento</span>
            </button>

            {/* Chatbot */}
            <button
              className={
                "sidebar-item" + (activeSection === "chatbot" ? " active" : "")
              }
              onClick={selectChatbot}
            >
              <span className="sidebar-item-label">Chatbot</span>
            </button>

            {/* Campanhas (grupo colapsável) */}
            <div className="sidebar-group">
              <button
                className={
                  "sidebar-item" +
                  (activeSection === "campaigns" ? " active" : "")
                }
                onClick={toggleCampaigns}
              >
                <span className="sidebar-item-label">Campanhas</span>
                <span className="sidebar-item-chevron">
                  {campaignsOpen ? "▾" : "▸"}
                </span>
              </button>

              {campaignsOpen && (
                <div className="sidebar-submenu">
                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "analytics" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("analytics")}
                  >
                    Analytics
                  </button>

                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "campaigns" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("campaigns")}
                  >
                    Campanhas
                  </button>

                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "templates" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("templates")}
                  >
                    Templates
                  </button>

                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "numbers" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("numbers")}
                  >
                    Números
                  </button>

                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "blacklist" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("blacklist")}
                  >
                    Blacklist
                  </button>

                  <button
                    className={
                      "sidebar-subitem" +
                      (activeCampaignTab === "files" ? " active" : "")
                    }
                    onClick={() => selectCampaignTab("files")}
                  >
                    Arquivos
                  </button>
                </div>
              )}
            </div>

            {/* Configurações */}
            <button
              className={
                "sidebar-item" + (activeSection === "settings" ? " active" : "")
              }
              onClick={selectSettings}
            >
              <span className="sidebar-item-label">Configurações</span>
            </button>
          </nav>

          {/* FOOTER – apenas versão, discreta */}
          <div className="sidebar-footer">
            <span className="sidebar-version">Versão 1.0.4</span>
          </div>
        </aside>

        {/* CONTEÚDO PRINCIPAL */}
        <main className="main-content">
          {activeSection === "inbound" && <ChatHistoryPage />}

          {activeSection === "chatbot" && <ChatbotPage />}

          {activeSection === "campaigns" && (
            <>
              {activeCampaignTab === "analytics" && <CampaignsAnalyticsPage />}
              {activeCampaignTab === "campaigns" && <CampaignsPage />}
              {activeCampaignTab === "templates" && <TemplatesPage />}
              {activeCampaignTab === "numbers" && <NumbersPage />}
              {activeCampaignTab === "blacklist" && <BlacklistPage />}
              {activeCampaignTab === "files" && <FilesPage />}
            </>
          )}

          {activeSection === "settings" && <SettingsChannelsPage />}
        </main>
      </div>
    </div>
  );
}
