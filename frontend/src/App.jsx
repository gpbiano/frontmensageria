// frontend/src/App.jsx
import ChatHistoryPage from "./ChatHistoryPage";
import "./chat-history.css";

function App() {
  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-logo">
          <span className="app-logo-main">GP Labs</span>
          <span className="app-logo-sub">Plataforma WhatsApp</span>
        </div>
        <div className="app-header-right">
          <span className="app-env-badge">Dev • Local</span>
        </div>
      </header>

      <main className="app-main">
        <ChatHistoryPage />
      </main>
    </div>
  );
}

export default App;
