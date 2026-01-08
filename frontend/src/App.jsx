// frontend/src/App.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, useLocation, useNavigate } from "react-router-dom";

import LoginPage from "./pages/LoginPage.jsx";
import { mpIdentify, mpTrack, mpReset } from "./lib/mixpanel";

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

// ✅ Admin Routes (NOVO)
import AdminRoutes from "./routes/adminRoutes.jsx";

/* ==========================================================
   CSS (ORDEM CORRETA)
========================================================== */
import "./styles/index.css";
import "./styles/app-shell.css";
import "./styles/App.css";

// ✅ Chat (módulos sensíveis)
import "./styles/chat-panel.css";
import "./styles/chat-composer.css";
import "./styles/chat-history.css";
import "./styles/chat-human.css";
import "./styles/chatbot.css";
import "./styles/chatbot-history.css";

// ✅ Páginas / módulos
import "./styles/login-page.css";
import "./styles/create-password.css";
import "./styles/optout.css";

import "./styles/outbound.css";
import "./styles/campaigns.css";
import "./styles/templates-create.css";
import "./styles/assets.css";

import "./styles/settings-groups.css";
import "./styles/settings-channels.css";
import "./styles/settings-users.css";

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
  UserCircle,
  LifeBuoy,
  Shield
} from "lucide-react";

const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

// Sidebar state
const SIDEBAR_LS_COLLAPSED = "gp.sidebar.collapsed";
const SIDEBAR_LS_OPEN = "gp.sidebar.openSection";

// ✅ Help Portal
const HELP_PORTAL_URL = "https://gplabs.atlassian.net/servicedesk/customer/portals";

/* ==========================================================
   AUTH HELPERS
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

  window.dispatchEvent(new Event("gp-auth-changed"));
}

/* ==========================================================
   APP
========================================================== */
export default function App() {
  // ✅ Página pública (sem login): /criar-senha?token=...
  const isCreatePasswordRoute = useMemo(() => {
    if (typeof window === "undefined") return false;
    const path = window.location.pathname || "/";
    return path === "/criar-senha";
  }, []);

  // ✅ gatilho para recalcular auth quando o token mudar (mesma aba)
  const [authVersion, setAuthVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    function bump() {
      setAuthVersion((v) => v + 1);
    }

    function onStorage(e) {
      if (e.key === AUTH_TOKEN_KEY || e.key === AUTH_USER_KEY) bump();
    }

    function onAuthChanged() {
      bump();
    }

    function onFocus() {
      bump();
    }

    window.addEventListener("storage", onStorage);
    window.addEventListener("gp-auth-changed", onAuthChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("gp-auth-changed", onAuthChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const tokenNow = useMemo(() => (getStoredAuthToken() || "").trim(), [authVersion]);
  const isAuthenticated = Boolean(tokenNow);

  function handleLogin(payload) {
    window.dispatchEvent(new Event("gp-auth-changed"));
    if (payload?.user) mpIdentify(payload.user);
  }

  function handleLogout(payload = {}) {
    mpTrack("auth_logout", { source: payload?.source || "user_menu" });
    mpReset();
    clearStoredAuth();
  }

  if (isCreatePasswordRoute) return <CreatePasswordPage />;
  if (!isAuthenticated) return <LoginPage onLogin={handleLogin} />;

  return (
    <BrowserRouter>
      <PlatformShell onLogout={handleLogout} />
    </BrowserRouter>
  );
}

/* ==========================================================
   MENU
========================================================== */
const SECTION_ICONS = {
  atendimento: MessageSquare,
  chatbot: Bot,
  campanhas: Megaphone,
  configuracoes: Settings,
  admin: Shield
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
  config: Settings,

  dashboard: BarChart3,
  cadastros: Building2,
  financeiro: FileText,
  monitor: Layers
};

const BASE_MENU = [
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
   PLATFORM SHELL
========================================================== */
function PlatformShell({ onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();

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

  // ✅ Se por qualquer motivo o token sumir, derruba sessão
  const didAutoLogoutRef = useRef(false);
  useEffect(() => {
    const t = (getStoredAuthToken() || "").trim();
    if (!t && !didAutoLogoutRef.current) {
      didAutoLogoutRef.current = true;
      onLogout?.({ source: "token_missing" });
    }
  }, [onLogout]);

  // ✅ Empresa (mock)
  const companyName = "Grupo GP Participações";

  // ✅ Usuário logado
  const [authUser, setAuthUser] = useState(() => getStoredAuthUser());

  useEffect(() => {
    function sync() {
      const u = getStoredAuthUser();
      setAuthUser(u);
      if (u) mpIdentify(u);

      const t = (getStoredAuthToken() || "").trim();
      if (!t && !didAutoLogoutRef.current) {
        didAutoLogoutRef.current = true;
        onLogout?.({ source: "token_missing" });
      }
    }
    window.addEventListener("gp-auth-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("gp-auth-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, [onLogout]);

  const userDisplayName =
    (authUser?.name && String(authUser.name).trim()) ||
    (authUser?.email && String(authUser.email).trim()) ||
    "Usuário";

  const userEmail = (authUser?.email && String(authUser.email).trim()) || "";

  // ✅ Admin visibility
  const isSuperAdmin = authUser?.isSuperAdmin === true;

  // ✅ menu final (Admin só aparece pro Super Admin)
  const MENU = useMemo(() => {
    if (!isSuperAdmin) return BASE_MENU;

    return [
      ...BASE_MENU,
      {
        id: "admin",
        label: "Administração",
        items: [
          { id: "dashboard", label: "Dashboard" },
          { id: "cadastros", label: "Cadastros" },
          { id: "financeiro", label: "Financeiro" },
          { id: "monitor", label: "Monitor" }
        ]
      }
    ];
  }, [isSuperAdmin]);

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

  // ✅ admin route detector (reativo, sem gambiarra)
  const isAdminRoute = useMemo(() => {
    const p = location?.pathname || "/";
    return p.startsWith("/admin");
  }, [location?.pathname]);

  // ✅ resolve qual item admin está ativo pela URL
  const activeAdminItem = useMemo(() => {
    if (!isAdminRoute) return "";
    const p = location.pathname || "";
    if (p.startsWith("/admin/cadastros")) return "cadastros";
    if (p.startsWith("/admin/tenants")) return "cadastros"; // compat (rota antiga)
    if (p.startsWith("/admin/financeiro")) return "financeiro";
    if (p.startsWith("/admin/monitor")) return "monitor";
    if (p.startsWith("/admin/dashboard")) return "dashboard";
    return "cadastros";
  }, [isAdminRoute, location.pathname]);

  // ✅ page_view
  const lastPageRef = useRef("");
  useEffect(() => {
    const page = isAdminRoute
      ? `Admin > ${location.pathname}`
      : `${mainSectionLabel(mainSection)} > ${subSectionLabel(subSection)}`;

    const key = isAdminRoute ? `admin:${location.pathname}` : `${mainSection}:${subSection}`;
    if (lastPageRef.current === key) return;
    lastPageRef.current = key;

    mpTrack("page_view", {
      page,
      main: isAdminRoute ? "admin" : mainSection,
      sub: isAdminRoute ? location.pathname : subSection
    });
  }, [mainSection, subSection, isAdminRoute, location.pathname]);

  function handleHeaderClick(sectionId) {
    if (collapsed) {
      const sec = MENU.find((s) => s.id === sectionId);
      const first = sec?.items?.[0]?.id || "conversas";

      mpTrack("menu_item_click", { section_id: sectionId, item_id: first, collapsed: true });
      handleItemClick(sectionId, first);
      return;
    }

    setOpenSection((prev) => {
      const next = prev === sectionId ? null : sectionId;

      mpTrack("menu_section_toggle", {
        section_id: sectionId,
        action: next ? "open" : "close",
        collapsed: false
      });

      return next;
    });
  }

  function handleItemClick(sectionId, itemId) {
    mpTrack("menu_item_click", { section_id: sectionId, item_id: itemId, collapsed });

    // ✅ Admin: navega via React Router (corrige o “clic não roda”)
    if (sectionId === "admin") {
      setOpenSection(sectionId);

      if (itemId === "dashboard") return navigate("/admin/dashboard");
      if (itemId === "cadastros") return navigate("/admin/cadastros");
      if (itemId === "financeiro") return navigate("/admin/financeiro");
      if (itemId === "monitor") return navigate("/admin/monitor");

      return navigate("/admin/cadastros");
    }

    // ✅ resto continua state-based
    setMainSection(sectionId);
    setSubSection(itemId);
    setOpenSection(sectionId);

    // se estava no admin, volta para raiz
    if (isAdminRoute) navigate("/");
  }

  function goTo(main, sub) {
    setMainSection(main);
    setSubSection(sub);
    setOpenSection(main);
    if (isAdminRoute) navigate("/");
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
          {/* Empresa */}
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

          {/* Ajuda */}
          <a
            className="gp-help-btn"
            href={HELP_PORTAL_URL}
            target="_blank"
            rel="noreferrer"
            title="Central de Ajuda"
            onClick={() => mpTrack("help_click", { location: "header", url: HELP_PORTAL_URL })}
          >
            <LifeBuoy size={16} />
            {!collapsed && <span className="gp-help-text">Ajuda</span>}
          </a>

          {/* User */}
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
                  <div className="gp-dd-sub">{userEmail ? userEmail : "Perfil do usuário"}</div>
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
                    onLogout?.({ source: "user_menu" });
                  }}
                >
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="gp-header-accent" />
      </header>

      {/* BODY */}
      <div className="app-body">
        {/* SIDEBAR */}
        <nav className={"app-sidebar zenvia-sidebar" + (collapsed ? " is-collapsed" : "")}>
          <button
            type="button"
            className="sidebar-toggle-fab"
            onClick={() => {
              const next = !collapsed;
              setCollapsed(next);
              mpTrack("menu_sidebar_toggle", { collapsed: next });
            }}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          {MENU.map((section) => {
            const isOpen = openSection === section.id;
            const isActive = isAdminRoute ? section.id === "admin" : mainSection === section.id;
            const SectionIcon = SECTION_ICONS[section.id] || Layers;

            return (
              <div className="sidebar-section" key={section.id}>
                <button
                  type="button"
                  className={"sidebar-item-header" + (isActive ? " sidebar-item-header-active" : "")}
                  onClick={() => handleHeaderClick(section.id)}
                  title={collapsed ? section.label : undefined}
                >
                  <span className="sb-row">
                    <span className="sb-ic">
                      <SectionIcon size={18} />
                    </span>

                    {!collapsed && <span className="sb-label">{section.label}</span>}
                  </span>

                  {!collapsed && (
                    <span className={"sidebar-item-chevron" + (isOpen ? " open" : "")}>
                      <ChevronDown size={16} />
                    </span>
                  )}
                </button>

                {!collapsed && isOpen && (
                  <div className="sidebar-subitems">
                    {section.items.map((item) => {
                      const isItemActive =
                        section.id === "admin"
                          ? isAdminRoute && activeAdminItem === item.id
                          : mainSection === section.id && subSection === item.id;

                      const ItemIcon = ITEM_ICONS[item.id] || Layers;

                      return (
                        <button
                          type="button"
                          key={item.id}
                          className={"sidebar-link" + (isItemActive ? " sidebar-link-active" : "")}
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
          {isAdminRoute ? (
            // ✅ sem wrappers extras aqui (deixa o fundo padrão do app-main)
            <AdminRoutes />
          ) : (
            <SectionRenderer main={mainSection} sub={subSection} goTo={goTo} />
          )}
        </main>
      </div>
    </div>
  );
}

/* ==========================================================
   RENDER
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
    if (sub === "reportes")
      return (
        <div className="page-full">
          <CampaignsAnalyticsPage />
        </div>
      );

    if (sub === "campanhas")
      return (
        <div className="page-full">
          <CampaignsLegacyPage />
        </div>
      );

    if (sub === "sms")
      return (
        <div className="page-full">
          <SmsCampaignsPage />
        </div>
      );

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

    if (sub === "templates")
      return (
        <div className="page-full">
          <TemplatesPage />
        </div>
      );

    if (sub === "numeros")
      return (
        <div className="page-full">
          <NumbersPage />
        </div>
      );

    if (sub === "arquivos")
      return (
        <div className="page-full">
          <AssetsPage />
        </div>
      );

    if (sub === "optout")
      return (
        <div className="page-full">
          <OptOutPage />
        </div>
      );

    return <Placeholder title={`Campanhas · ${subSectionLabel(sub)}`} text="Seção em construção." />;
  }

  if (main === "configuracoes") {
    if (sub === "canais")
      return (
        <div className="page-full">
          <SettingsChannelsPage />
        </div>
      );

    if (sub === "usuarios")
      return (
        <div className="page-full">
          <SettingsUsersPage />
        </div>
      );

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
  if (main === "admin") return "Administração";
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
    case "dashboard":
      return "Dashboard";
    case "cadastros":
      return "Cadastros";
    case "financeiro":
      return "Financeiro";
    case "monitor":
      return "Monitor";
    default:
      return "";
  }
}
