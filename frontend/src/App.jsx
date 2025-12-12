// frontend/src/App.jsx
import { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage.jsx";

// Atendimento (HUMANO)
import ChatHumanPage from "./pages/human/ChatHumanPage.jsx";
import ChatHumanHistoryPage from "./pages/human/ChatHumanHistoryPage.jsx";

// Chatbot
import ChatbotHistoryPage from "./pages/chatbot/ChatbotHistoryPage.jsx";
import ChatbotConfigPage from "./pages/chatbot/ChatbotConfigPage.jsx";

// Outbound
import NumbersPage from "./pages/outbound/NumbersPage.jsx";
import TemplatesPage from "./pages/outbound/TemplatesPage.jsx";

// ✅ Campanhas
// ATENÇÃO: seu arquivo legacy ainda é CampaignsPage.jsx, então importamos ele e apelidamos como Legacy
import CampaignsLegacyPage from "./pages/outbound/campaigns/CampaignsPage.jsx";
import CampaignCreateWizard from "./pages/outbound/campaigns/CampaignCreateWizard.jsx";
import CampaignsAnalyticsPage from "./pages/outbound/campaigns/CampaignsAnalyticsPage.jsx";
import CampaignReport from "./pages/outbound/campaigns/CampaignReport.jsx";

// ✅ Arquivos (Assets)
import AssetsPage from "./pages/outbound/AssetsPage.jsx";

// CSS global da app
import "./styles/App.css";

const AUTH_KEY = "gpLabsAuthToken";

/* ==========================================================
   APLICAÇÃO PRINCIPAL
========================================================== */
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(AUTH_KEY);
    if (token) setIsAuthenticated(true);
  }, []);

  function handleLogin(data) {
    if (data?.token) localStorage.setItem(AUTH_KEY, data.token);
    setIsAuthenticated(true);
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
  }

  if (!isAuthenticated) return <LoginPage onLogin={handleLogin} />;

  return <PlatformShell onLogout={handleLogout} />;
}

/* ==========================================================
   MENU LATERAL (drilldown)
========================================================== */
const MENU = [
  {
    id: "atendimento",
    label: "Atendimento",
    items: [
      { id: "conversas", label: "Conversas" },
      { id: "grupos", label: "Grupos" },
      { id: "historico", label: "Histórico de Chats" }
    ]
  },
  {
    id: "chatbot",
    label: "Chatbot",
    items: [
      { id: "historico", label: "Histórico de Chats" },
      { id: "config", label: "Configurações" }
    ]
  },
  {
    id: "campanhas",
    label: "Campanhas",
    items: [
      { id: "reportes", label: "Reportes" },
      { id: "campanhas", label: "Campanhas" }, // ✅ LISTA (legacy)
      { id: "nova", label: "Criar campanha" }, // ✅ WIZARD
      { id: "templates", label: "Templates" },
      { id: "numeros", label: "Números" },
      { id: "arquivos", label: "Arquivos" },
      { id: "optout", label: "Opt-Out" }
    ]
  },
  {
    id: "configuracoes",
    label: "Configurações",
    items: [{ id: "canais", label: "Canais" }]
  }
];

/* ==========================================================
   SHELL DA PLATAFORMA
========================================================== */
function PlatformShell({ onLogout }) {
  // ✅ Default para não cair “em branco” nem entrar direto em campanhas
  const [mainSection, setMainSection] = useState("atendimento");
  const [subSection, setSubSection] = useState("conversas");
  const [openSection, setOpenSection] = useState("atendimento");

  function handleHeaderClick(sectionId) {
    setOpenSection((prev) => (prev === sectionId ? null : sectionId));
  }

  function handleItemClick(sectionId, itemId) {
    setMainSection(sectionId);
    setSubSection(itemId);
    setOpenSection(sectionId);
  }

  function goTo(main, sub) {
    setMainSection(main);
    setSubSection(sub);
    setOpenSection(main);
  }

  return (
    <div className="app-shell">
      {/* HEADER */}
      <header className="app-header">
        <div className="app-header-left">
          <div className="app-logo-circle">logo</div>
          <span className="app-header-title">Plataforma</span>
        </div>

        <div className="app-header-right">
          <button className="header-pill-btn">Empresa</button>
          <button className="header-pill-btn">Perfil User</button>
          <button className="header-pill-btn header-logout" onClick={onLogout}>
            Sair
          </button>
        </div>
      </header>

      {/* BODY */}
      <div className="app-body">
        {/* SIDEBAR */}
        <nav className="app-sidebar">
          {MENU.map((section) => {
            const isOpen = openSection === section.id;
            const isActive = mainSection === section.id;

            return (
              <div className="sidebar-section" key={section.id}>
                <button
                  className={
                    "sidebar-item-header" +
                    (isActive ? " sidebar-item-header-active" : "")
                  }
                  onClick={() => handleHeaderClick(section.id)}
                >
                  <span>{section.label}</span>
                  <span
                    className={"sidebar-item-chevron" + (isOpen ? " open" : "")}
                  >
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div className="sidebar-subitems">
                    {section.items.map((item) => {
                      const isItemActive =
                        mainSection === section.id && subSection === item.id;

                      return (
                        <button
                          key={item.id}
                          className={
                            "sidebar-link" +
                            (isItemActive ? " sidebar-link-active" : "")
                          }
                          onClick={() => handleItemClick(section.id, item.id)}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* MAIN */}
        <main className="app-main">
          <SectionRenderer main={mainSection} sub={subSection} goTo={goTo} />
        </main>
      </div>
    </div>
  );
}

/* ==========================================================
   RENDER DE SEÇÕES
========================================================== */
function SectionRenderer({ main, sub, goTo }) {
  // Atendimento → Conversas
  if (main === "atendimento" && sub === "conversas") {
    return (
      <div className="page-full">
        <ChatHumanPage />
      </div>
    );
  }

  // Atendimento → Grupos (placeholder por enquanto)
  if (main === "atendimento" && sub === "grupos") {
    return (
      <Placeholder
        title="Atendimento · Grupos"
        text="Em breve: suporte a grupos (WhatsApp Groups) e histórico dedicado."
      />
    );
  }

  // Atendimento → Histórico de Chats
  if (main === "atendimento" && sub === "historico") {
    return (
      <div className="page-full">
        <ChatHumanHistoryPage />
      </div>
    );
  }

  // Chatbot → Histórico
  if (main === "chatbot" && sub === "historico") {
    return (
      <div className="page-full">
        <ChatbotHistoryPage />
      </div>
    );
  }

  // Chatbot → Configurações
  if (main === "chatbot" && sub === "config") {
    return (
      <div className="page-full">
        <ChatbotConfigPage />
      </div>
    );
  }

  // ===============================
  // CAMPANHAS
  // ===============================
  if (main === "campanhas") {
    if (sub === "reportes") {
      return (
        <div className="page-full">
          <CampaignsAnalyticsPage />
        </div>
      );
    }

    // ✅ LISTA (legacy)
    if (sub === "campanhas") {
      return (
        <div className="page-full">
          <CampaignsLegacyPage />
        </div>
      );
    }

    // ✅ WIZARD
    if (sub === "nova") {
      return (
        <div className="page-full">
          {/* o Wizard atual não recebe props; saída controlada pelo menu */}
          <CampaignCreateWizard />
          <div style={{ marginTop: 12 }}>
            <button
              className="cmp-btn"
              onClick={() => goTo("campanhas", "campanhas")}
              title="Voltar para Campanhas"
            >
              Voltar para Campanhas
            </button>
          </div>
        </div>
      );
    }

    // ✅ Arquivos (Assets)
    if (sub === "arquivos") {
      return (
        <div className="page-full">
          <AssetsPage />
        </div>
      );
    }

    // ✅ Report (opcional)
    if (sub === "report") {
      return (
        <div className="page-full">
          <CampaignReport />
        </div>
      );
    }

    if (sub === "numeros") {
      return (
        <div className="page-full">
          <NumbersPage />
        </div>
      );
    }

    if (sub === "templates") {
      return (
        <div className="page-full">
          <TemplatesPage />
        </div>
      );
    }

    return (
      <Placeholder
        title={`Campanhas · ${subSectionLabel(sub)}`}
        text="Em breve: módulo completo de campanhas com reports, templates, números e opt-out."
      />
    );
  }

  if (main === "configuracoes") {
    return (
      <Placeholder
        title={`Configurações · ${subSectionLabel(sub)}`}
        text="Configurações gerais da plataforma, canais e integrações."
      />
    );
  }

  return (
    <Placeholder
      title={`${mainSectionLabel(main)} · ${subSectionLabel(sub)}`}
      text="Seção em construção."
    />
  );
}

/* ==========================================================
   AUXILIARES
========================================================== */
function Placeholder({ title, text }) {
  return (
    <div className="page-placeholder">
      <h2 style={{ marginBottom: 8 }}>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function mainSectionLabel(main) {
  if (main === "atendimento") return "Atendimento";
  if (main === "chatbot") return "Chatbot";
  if (main === "campanhas") return "Campanhas";
  if (main === "configuracoes") return "Configurações";
  return "Plataforma";
}

function subSectionLabel(sub) {
  switch (sub) {
    case "conversas":
      return "Conversas";
    case "grupos":
      return "Grupos";
    case "historico":
      return "Histórico de Chats";
    case "reportes":
      return "Reportes";
    case "campanhas":
      return "Campanhas";
    case "nova":
      return "Criar campanha";
    case "templates":
      return "Templates";
    case "numeros":
      return "Números";
    case "arquivos":
      return "Arquivos";
    case "optout":
      return "Opt-Out";
    case "canais":
      return "Canais";
    case "config":
      return "Configurações";
    default:
      return "";
  }
}
