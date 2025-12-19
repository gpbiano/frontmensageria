// frontend/src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
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

// ✅ Reportes
import CampaignsAnalyticsPage from "./pages/outbound/campaigns/CampaignsAnalyticsPage.jsx";

// ✅ SMS
import SmsCampaignsPage from "./pages/outbound/sms/SmsCampaignsPage.jsx";

// Assets
import AssetsPage from "./pages/outbound/AssetsPage.jsx";

// Opt-Out
import OptOutPage from "./pages/outbound/OptOutPage.tsx";

// ✅ Settings
import SettingsUsersPage from "./pages/settings/SettingsUsersPage.jsx";
import SettingsGroupsPage from "./pages/settings/SettingsGroupsPage.jsx";
import SettingsChannelsPage from "./pages/settings/SettingsChannelsPage.jsx";

// Criar Senha (Público)
import CreatePasswordPage from "./pages/auth/CreatePasswordPage.jsx";

// CSS
import "./styles/App.css";
import "./styles/outbound.css";
import "./styles/settings-groups.css";
import "./styles/settings-channels.css";

// ✅ Ícones
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  MessageSquare,
  Layers,
  History,
  Bot,
  Settings,
  BarChart3,
  Megaphone,
  PlusCircle,
  FileText,
  Hash,
  FolderOpen,
  ShieldOff,
  Users,
  Building2,
  UserCircle
} from "lucide-react";

const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

// Sidebar state
const SIDEBAR_LS_COLLAPSED = "gp.sidebar.collapsed";
const SIDEBAR_LS_OPEN = "gp.sidebar.openSection";

/* ==========================================================
   AUTH HELPERS (localStorage OU sessionStorage)
========================================================== */
function getStoredAuthToken() {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem(AUTH_TOKEN_KEY) ||
    sessionStorage.getItem(AUTH_TOKEN_KEY) ||
    ""
  );
}

function getStoredAuthUser() {
  if (typeof window === "undefined") return null;

  const raw =
    localStorage.getItem(AUTH_USER_KEY) ||
    sessionStorage.getItem(AUTH_USER_KEY) ||
    "";

  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearStoredAuth() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
}

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
    const token = getStoredAuthToken();
    if (token) setIsAuthenticated(true);
  }, []);

  function handleLogin(data) {
    // ✅ LoginPage já salva token/user.
    // Aqui só marca como autenticado.
    if (typeof window === "undefined") return;

    const token = data?.token || getStoredAuthToken();
    if (token) setIsAuthenticated(true);
  }

  function handleLogout() {
    if (typeof window === "undefined") return;
    clearStoredAuth();
    setIsAuthenticated(false);
  }

  if (isCreatePasswordRoute) return <CreatePasswordPage />;
  if (!isAuthenticated) return <LoginPage onLogin={handleLogin} />;

  return <PlatformShell onLogout={handleLogout} />;
}

/* ==========================================================
   MENU LATERAL
========================================================== */
const SECTION_ICONS = {
  atendimento: MessageSquare,
  chatbot: Bot,
  campanhas: Megaphone,
  configuracoes: Settings
};

const ITEM_ICONS = {
  conversas: MessageSquare,
  grupos: Users,
  historico: History,

  reportes: BarChart3,
  campanhas: Layers,
  sms: Megaphone,
  nova: PlusCircle,
  templates: FileText,
  numeros: Hash,
  arquivos: FolderOpen,
  optout: ShieldOff,

  canais: Settings,
  usuarios: Users,
  config: Settings
};

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
      { id: "sms", label: "Campanhas de SMS" },
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
    ]
  }
];

/* ==========================================================
   SHELL DA PLATAFORMA
========================================================== */
function PlatformShell({ onLogout }) {
  const [mainSection, setMainSection] = useState("atendimento");
  const [subSection, setSubSection] = useState("conversas");

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(SIDEBAR_LS_COLLAPSED) === "true";
  });

  const [openSection, setOpenSection] = useState(() => {
    if (typeof window === "undefined") return "atendimento";
    return localStorage.getItem(SIDEBAR_LS_OPEN) || "atendimento";
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SIDEBAR_LS_COLLAPSED, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (openSection) localStorage.setItem(SIDEBAR_LS_OPEN, openSection);
  }, [openSection]);

  // ✅ Empresa (mock por enquanto)
  const companyName = "Grupo GP Participações";

  // ✅ Usuário logado (real)
  const [authUser, setAuthUser] = useState(() => getStoredAuthUser());

  useEffect(() => {
    // Atualiza se o usuário trocar em outra aba/janela
    function onStorage(e) {
      if (e.key === AUTH_USER_KEY || e.key === AUTH_TOKEN_KEY) {
        setAuthUser(getStoredAuthUser());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const userDisplayName =
    (authUser?.name && String(authUser.name).trim()) ||
    (authUser?.email && String(authUser.email).trim()) ||
    "Usuário";

  const userEmail = (authUser?.email && String(authUser.email).trim()) || "";

  // dropdowns header
  const [isCompanyOpen, setIsCompanyOpen] = useState(false);
  const [isUserOpen, setIsUserOpen] = useState(false);
  const headerRef = useRef(null);

  useEffect(() => {
    function onDocClick(e) {
      if (!headerRef.current) return;
      if (!headerRef.current.contains(e.target)) {
        setIsCompanyOpen(false);
        setIsUserOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  function handleHeaderClick(sectionId) {
    // Em modo colapsado: clicar no header leva direto pro primeiro item
    if (collapsed) {
      const sec = MENU.find((s) => s.id === sectionId);
      const first = sec?.items?.[0]?.id || "conversas";
      handleItemClick(sectionId, first);
      return;
    }
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
      <header className="app-header gp-header" ref={headerRef}>
        <div className="app-header-left">
          <img src="/gp-labs-logo.png" alt="GP Labs" className="gp-top-logo" />
          <span className="app-header-title app-product-name">
            Cliente <span className="app-product-name-accent">OnLine</span>
          </span>
        </div>

        <div className="app-header-right gp-header-actions">
          {/* Empresa logada (dropdown) */}
          <div className="gp-dd">
            <button
              type="button"
              className="gp-dd-btn"
              onClick={() => {
                setIsCompanyOpen((v) => !v);
                setIsUserOpen(false);
              }}
              title="Empresa logada"
            >
              <Building2 size={16} />
              <span className="gp-dd-btn-text">{companyName}</span>
              <ChevronDown size={16} />
            </button>

            {isCompanyOpen && (
              <div className="gp-dd-menu">
                <div className="gp-dd-title">Empresa logada</div>
                <div className="gp-dd-item is-muted">
                  {companyName}
                  <div className="gp-dd-sub">Organização ativa</div>
                </div>
                <div className="gp-dd-sep" />
                <button
                  type="button"
                  className="gp-dd-item"
                  onClick={() => {
                    setIsCompanyOpen(false);
                    alert("Em breve: alternar empresa.");
                  }}
                >
                  Alternar empresa (em breve)
                </button>
              </div>
            )}
          </div>

          {/* Perfil do usuário (dropdown com sair) */}
          <div className="gp-dd">
            <button
              type="button"
              className="gp-dd-btn gp-dd-btn--user"
              onClick={() => {
                setIsUserOpen((v) => !v);
                setIsCompanyOpen(false);
              }}
              title="Perfil"
            >
              <UserCircle size={16} />
              <span className="gp-dd-btn-text">{userDisplayName}</span>
              <ChevronDown size={16} />
            </button>

            {isUserOpen && (
              <div className="gp-dd-menu">
                <div className="gp-dd-title">Usuário</div>

                <div className="gp-dd-item is-muted">
                  {userDisplayName}
                  <div className="gp-dd-sub">
                    {userEmail ? userEmail : "Perfil do usuário"}
                  </div>
                </div>

                <div className="gp-dd-sep" />
                <button
                  type="button"
                  className="gp-dd-item"
                  onClick={() => {
                    setIsUserOpen(false);
                    alert("Em breve: página de perfil.");
                  }}
                >
                  Perfil
                </button>
                <button
                  type="button"
                  className="gp-dd-item is-danger"
                  onClick={() => {
                    setIsUserOpen(false);
                    onLogout?.();
                  }}
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Linha de destaque */}
        <div className="gp-header-accent" />
      </header>

      {/* BODY */}
      <div className="app-body">
        {/* SIDEBAR */}
        <nav
          className={
            "app-sidebar zenvia-sidebar" + (collapsed ? " is-collapsed" : "")
          }
          style={{ width: collapsed ? 76 : 320 }}
        >
          {/* ✅ Toggle SEMPRE visível */}
          <button
            type="button"
            className="sidebar-toggle-fab"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          {MENU.map((section) => {
            const isOpen = openSection === section.id;
            const isActive = mainSection === section.id;
            const SectionIcon = SECTION_ICONS[section.id] || Layers;

            return (
              <div className="sidebar-section" key={section.id}>
                <button
                  type="button"
                  className={
                    "sidebar-item-header" +
                    (isActive ? " sidebar-item-header-active" : "")
                  }
                  onClick={() => handleHeaderClick(section.id)}
                  title={collapsed ? section.label : undefined}
                >
                  <span className="sb-row">
                    <span className="sb-ic">
                      <SectionIcon size={18} />
                    </span>

                    {!collapsed && (
                      <span className="sb-label">{section.label}</span>
                    )}
                  </span>

                  {!collapsed && (
                    <span
                      className={
                        "sidebar-item-chevron" + (isOpen ? " open" : "")
                      }
                    >
                      <ChevronDown size={16} />
                    </span>
                  )}
                </button>

                {!collapsed && isOpen && (
                  <div className="sidebar-subitems">
                    {section.items.map((item) => {
                      const isItemActive =
                        mainSection === section.id && subSection === item.id;
                      const ItemIcon = ITEM_ICONS[item.id] || Layers;

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
                          <span className="sb-sub-ic">
                            <ItemIcon size={16} />
                          </span>
                          <span>{item.label}</span>
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
  if (main === "atendimento" && sub === "conversas") {
    return (
      <div className="page-full">
        <ChatHumanPage />
      </div>
    );
  }

  if (main === "atendimento" && sub === "grupos") {
    return (
      <div className="page-full">
        <SettingsGroupsPage />
      </div>
    );
  }

  if (main === "atendimento" && sub === "historico") {
    return (
      <div className="page-full">
        <ChatHumanHistoryPage />
      </div>
    );
  }

  if (main === "chatbot" && sub === "historico") {
    return (
      <div className="page-full">
        <ChatbotHistoryPage />
      </div>
    );
  }

  if (main === "chatbot" && sub === "config") {
    return (
      <div className="page-full">
        <ChatbotConfigPage />
      </div>
    );
  }

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

    if (sub === "sms") {
      return (
        <div className="page-full">
          <SmsCampaignsPage />
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
      <Placeholder
        title={`Campanhas · ${subSectionLabel(sub)}`}
        text="Seção em construção."
      />
    );
  }

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
    case "sms":
      return "Campanhas de SMS";
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
