// frontend/src/App.jsx
import { useEffect, useMemo, useState } from "react";
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

// Campanhas (legacy + wizard)
import CampaignsLegacyPage from "./pages/outbound/campaigns/CampaignsPage.jsx";
import CampaignCreateWizard from "./pages/outbound/campaigns/CampaignCreateWizard.jsx";

// ✅ Reportes (Analytics “Meta-like”)
import CampaignsAnalyticsPage from "./pages/outbound/campaigns/CampaignsAnalyticsPage.jsx";

// Assets
import AssetsPage from "./pages/outbound/AssetsPage.jsx";

// Opt-Out
import OptOutPage from "./pages/outbound/OptOutPage.tsx";

// ✅ Settings — Users
import SettingsUsersPage from "./pages/settings/SettingsUsersPage.jsx";

// ✅ Settings — Groups
import SettingsGroupsPage from "./pages/settings/SettingsGroupsPage.jsx";

// ✅ Settings — Channels (NOVA)
import SettingsChannelsPage from "./pages/settings/SettingsChannelsPage.jsx";

// Criar Senha (Público)
import CreatePasswordPage from "./pages/auth/CreatePasswordPage.jsx";

// CSS global
import "./styles/App.css";

// CSS específico de outbound / reports / analytics
import "./styles/outbound.css";

// ✅ CSS da página de grupos
import "./styles/settings-groups.css";

// ✅ CSS da página de canais
import "../../styles/settings-channels.css";


const AUTH_KEY = "gpLabsAuthToken";

/* ==========================================================
   APLICAÇÃO PRINCIPAL
========================================================== */
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  // ✅ Página pública (sem login): /criar-senha?token=...
  const isCreatePasswordRoute = useMemo(() => {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname || "/";
    return path === "/criar-senha";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem(AUTH_KEY);
    if (token) setIsAuthenticated(true);
  }, []);

  function handleLogin(data) {
    if (typeof window === "undefined") return;
    if (data?.token) localStorage.setItem(AUTH_KEY, data.token);
    setIsAuthenticated(true);
  }

  function handleLogout() {
    if (typeof window === "undefined") return;
    localStorage.removeItem(AUTH_KEY);
    setIsAuthenticated(false);
  }

  // ✅ importante: criar senha precisa funcionar SEM autenticação
  if (isCreatePasswordRoute) return <CreatePasswordPage />;

  if (!isAuthenticated) return <LoginPage onLogin={handleLogin} />;

  return <PlatformShell onLogout={handleLogout} />;
}

/* ==========================================================
   MENU LATERAL
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
      { id: "campanhas", label: "Campanhas" },
      { id: "nova", label: "Criar campanha" },
      { id: "templates", label: "Templates" },
      { id: "numeros", label: "Números" },
      { id: "arquivos", label: "Arquivos" },
      { id: "optout", label: "Opt-Out" }
    ]
  },
  {
    id: "configuracoes",
    label: "Configurações",
    items: [
      { id: "canais", label: "Canais" },
      { id: "usuarios", label: "Usuários" }
      // { id: "grupos", label: "Grupos" }
    ]
  }
];

/* ==========================================================
   SHELL DA PLATAFORMA
========================================================== */
function PlatformShell({ onLogout }) {
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
          <button className="header-pill-btn" type="button">
            Empresa
          </button>
          <button className="header-pill-btn" type="button">
            Perfil User
          </button>
          <button
            className="header-pill-btn header-logout"
            type="button"
            onClick={onLogout}
          >
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
                  type="button"
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
                          type="button"
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

  // ✅ Atendimento → Grupos
  if (main === "atendimento" && sub === "grupos") {
    return (
      <div className="page-full">
        <SettingsGroupsPage />
      </div>
    );
  }

  // Atendimento → Histórico
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

  // Campanhas
  if (main === "campanhas") {
    if (sub === "reportes") {
      return (
        <div className="page-full">
          <CampaignsAnalyticsPage />
        </div>
      );
    }

    if (sub === "campanhas") {
      return (
        <div className="page-full">
          <CampaignsLegacyPage />
        </div>
      );
    }

    if (sub === "nova") {
      return (
        <div className="page-full">
          <CampaignCreateWizard />
          <div style={{ marginTop: 12 }}>
            <button
              className="cmp-btn"
              type="button"
              onClick={() => goTo("campanhas", "campanhas")}
              title="Voltar para Campanhas"
            >
              Voltar para Campanhas
            </button>
          </div>
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

    if (sub === "numeros") {
      return (
        <div className="page-full">
          <NumbersPage />
        </div>
      );
    }

    if (sub === "arquivos") {
      return (
        <div className="page-full">
          <AssetsPage />
        </div>
      );
    }

    if (sub === "optout") {
      return (
        <div className="page-full">
          <OptOutPage />
        </div>
      );
    }

    return (
      <Placeholder title={`Campanhas · ${subSectionLabel(sub)}`} text="Seção em construção." />
    );
  }

  // ✅ Configurações
  if (main === "configuracoes") {
    if (sub === "canais") {
      return (
        <div className="page-full">
          <SettingsChannelsPage />
        </div>
      );
    }

    if (sub === "usuarios") {
      return (
        <div className="page-full">
          <SettingsUsersPage />
        </div>
      );
    }

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
    case "usuarios":
      return "Usuários";
    case "config":
      return "Configurações";
    default:
      return "";
  }
}
