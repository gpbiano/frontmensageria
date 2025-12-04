// frontend/src/App.jsx
import { useEffect, useState } from "react";
import ChatHistoryPage from "./ChatHistoryPage";
import CampaignsPage from "./outbound/CampaignsPage";
import LoginPage from "./LoginPage";

import "./App.css";
import "./chat-history.css";

const AUTH_KEY = "gpLabsAuthToken";

function App() {
  const [activeSection, setActiveSection] = useState("inbound");
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_KEY);
    if (token) {
      setIsAuthenticated(true);
    }
  }, []);

  function handleLogin(data) {
    console.log("✅ Login bem-sucedido no App.jsx:", data);
    setIsAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem("gpLabsUser");
    localStorage.removeItem("gpLabsRememberMe");
    setIsAuthenticated(false);
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo">
            <img
              src="/gp-labs-logo.png"
              alt="GP Labs"
              className="app-logo-img"
            />
            <div className="app-logo-text">
              <span className="app-logo-main">GP LABS</span>
              <span className="app-logo-sub">Plataforma WhatsApp</span>
            </div>
          </div>

          <nav className="app-nav">
            <button
              className={activeSection === "inbound" ? "active" : ""}
              onClick={() => setActiveSection("inbound")}
            >
              Atendimento
            </button>
            <button
              className={activeSection === "outbound" ? "active" : ""}
              onClick={() => setActiveSection("outbound")}
            >
              Campanhas
            </button>
          </nav>
        </div>

        <div className="app-header-right">
          <span className="app-env-badge">Dev • Local</span>
          <button className="app-logout-btn" onClick={handleLogout}>
            Sair
          </button>
        </div>
      </header>

      <main className="app-main">
        {activeSection === "inbound" ? <ChatHistoryPage /> : <CampaignsPage />}
      </main>
    </div>
  );
}

export default App;

