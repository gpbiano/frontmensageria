// frontend/src/App.jsx
import { useState } from "react";
import ChatHistoryPage from "./ChatHistoryPage";
import CampaignsPage from "./outbound/CampaignsPage";

import "./App.css";
import "./chat-history.css";

function App() {
  const [activeSection, setActiveSection] = useState("inbound");

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo">
            {/* Logo da GP Labs - coloque o arquivo em frontend/public/gp-labs-logo.svg */}
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
        </div>
      </header>

      <main className="app-main">
        {activeSection === "inbound" ? <ChatHistoryPage /> : <CampaignsPage />}
      </main>
    </div>
  );
}

export default App;

