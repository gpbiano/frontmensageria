// frontend/src/App.jsx
import { useEffect, useState } from "react";

import ChatHistoryPage from "./ChatHistoryPage.jsx";
import CampaignsPage from "./outbound/CampaignsPage.jsx";
import TemplatesPage from "./outbound/TemplatesPage.jsx";
import MediaLibrary from "./outbound/MediaLibrary.jsx";
import CampaignReport from "./outbound/CampaignReport.jsx";
import CampaignsAnalyticsPage from "./outbound/CampaignsAnalyticsPage.jsx";
import NumbersPage from "./outbound/NumbersPage.jsx";
import BlacklistPage from "./outbound/BlacklistPage.jsx";
import FilesPage from "./outbound/FilesPage.jsx";

import GlobalHeader from "./components/GlobalHeader.jsx";

// CHATBOT
import ChatbotPage from "./chatbot/ChatbotPage.jsx";

// SETTINGS
import SettingsChannelsPage from "./settings/SettingsChannelsPage.jsx";
import LoginPage from "./LoginPage.jsx";

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

  // auto login se tiver token
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
    setIsAuthenticated(false);
  }

  // Navegação
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

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      {/* HEADER GLOBAL – ocupa todo o topo */}
      <GlobalHeader
        appCompanyName="GP Labs"
        holdingName="GP Holding Participações Ltda."
        clientCompanyName="GP Labs"
        userName="Genivaldo Peres"
      />

      {/* LAYOUT PRINCIPAL: SIDEBAR + CONTEÚDO */}
      <div className="app-main">
        {/* SIDEBAR (sem cabeçalho interno, só menu + footer) */}
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

            {/* Campanhas */}
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
                    BlackList
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

          {/* FOOTER DA SIDEBAR */}
          <div className="sidebar-footer">
            <div className="sidebar-footer-info">
              <div className="sidebar-footer-title">
                GP Labs Plataforma WhatsApp
              </div>
              <div className="sidebar-footer-version">
                Versão 1.0.4 • Ambiente DEV
              </div>
            </div>


          </div>
        </aside>

        {/* CONTEÚDO DAS PÁGINAS */}
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

