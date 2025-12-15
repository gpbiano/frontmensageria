import { useEffect, useMemo, useState } from "react";
import {
  Home,
  Users,
  Send,
  MessageSquare,
  Bot,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from "lucide-react";

const LS_COLLAPSED = "gp.sidebar.collapsed";
const LS_OPEN = "gp.sidebar.openSection";

function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}

export default function Sidebar({
  mainSection,
  subSection,
  setMainSection,
  setSubSection
}) {
  const [collapsed, setCollapsed] = useState(
    localStorage.getItem(LS_COLLAPSED) === "true"
  );
  const [openSection, setOpenSection] = useState(
    localStorage.getItem(LS_OPEN) || "atendimento"
  );

  useEffect(() => {
    localStorage.setItem(LS_COLLAPSED, String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    localStorage.setItem(LS_OPEN, openSection);
  }, [openSection]);

  const sections = useMemo(
    () => [
      {
        key: "inicio",
        label: "Início",
        icon: Home,
        items: [{ key: "inicio", label: "Início" }]
      },
      {
        key: "atendimento",
        label: "Atendimento",
        icon: MessageSquare,
        items: [
          { key: "conversas", label: "Conversas" },
          { key: "historico_humano", label: "Histórico" }
        ]
      },
      {
        key: "contatos",
        label: "Contatos",
        icon: Users,
        items: [{ key: "contatos", label: "Contatos" }]
      },
      {
        key: "campanhas",
        label: "Campanhas",
        icon: Send,
        items: [
          { key: "reportes", label: "Relatórios" },
          { key: "lista", label: "Campanhas" },
          { key: "criar", label: "Criar campanha" },
          { key: "templates", label: "Templates" },
          { key: "numeros", label: "Números" },
          { key: "arquivos", label: "Arquivos" },
          { key: "optout", label: "Opt-out" },
          { key: "sms", label: "SMS" }
        ]
      },
      {
        key: "chatbot",
        label: "Chatbot",
        icon: Bot,
        items: [
          { key: "historico", label: "Histórico" },
          { key: "config", label: "Configurações" }
        ]
      },
      {
        key: "analises",
        label: "Análises",
        icon: BarChart3,
        items: [{ key: "analises", label: "Análises" }]
      },
      {
        key: "config",
        label: "Configurações",
        icon: Settings,
        items: [
          { key: "canais", label: "Canais" },
          { key: "usuarios", label: "Usuários" },
          { key: "grupos", label: "Grupos" }
        ]
      }
    ],
    []
  );

  function goTo(sectionKey, itemKey) {
    setMainSection(sectionKey);
    setSubSection(itemKey);
    setOpenSection(sectionKey);
  }

  function toggleSection(key) {
    setOpenSection((prev) => (prev === key ? "" : key));
  }

  return (
    <aside className={cx("gp-sidebar", collapsed && "is-collapsed")}>
      {/* Brand */}
      <div className="gp-sidebar__brand">
        <div className="gp-logo-badge" title="GP Labs">
          {/* Troque por <img src="/logo-gp.svg" .../> quando quiser */}
          <span className="gp-logo-text">GP</span>
        </div>

        {!collapsed && (
          <div className="gp-brand-title">
            <div className="gp-brand-name">GP Labs</div>
            <div className="gp-brand-sub">Plataforma</div>
          </div>
        )}

        <button
          className="gp-collapse-btn"
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
          type="button"
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
      </div>

      {/* Nav */}
      <nav className="gp-nav">
        {sections.map((sec) => {
          const Icon = sec.icon;
          const isOpen = openSection === sec.key;

          // item ativo
          const isActiveSection = mainSection === sec.key;

          return (
            <div key={sec.key} className="gp-nav__section">
              <button
                type="button"
                className={cx(
                  "gp-nav__sectionBtn",
                  isActiveSection && "is-active"
                )}
                onClick={() => {
                  if (collapsed) {
                    // colapsado: navega direto pro primeiro item
                    goTo(sec.key, sec.items[0]?.key || sec.key);
                    return;
                  }
                  // aberto: abre/fecha e também pode navegar pro primeiro item
                  toggleSection(sec.key);
                }}
                title={collapsed ? sec.label : undefined}
              >
                <span className="gp-nav__icon">
                  <Icon size={18} />
                </span>

                {!collapsed && (
                  <>
                    <span className="gp-nav__label">{sec.label}</span>
                    <span className={cx("gp-nav__chev", isOpen && "is-open")}>
                      <ChevronDown size={16} />
                    </span>
                  </>
                )}
              </button>

              {!collapsed && isOpen && (
                <div className="gp-nav__items">
                  {sec.items.map((it) => {
                    const active =
                      mainSection === sec.key && subSection === it.key;

                    return (
                      <button
                        key={it.key}
                        type="button"
                        className={cx("gp-nav__item", active && "is-active")}
                        onClick={() => goTo(sec.key, it.key)}
                      >
                        {it.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
