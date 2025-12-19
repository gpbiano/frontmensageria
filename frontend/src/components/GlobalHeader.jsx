// frontend/src/components/GlobalHeader.jsx
import { useState, useRef, useEffect, useMemo } from "react";

const AUTH_USER_KEY = "gpLabsAuthUser";

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

export default function GlobalHeader({ onLogout }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);

  const [authUser, setAuthUser] = useState(() => getStoredAuthUser());

  // Atualiza usuário se trocar em outra aba/janela
  useEffect(() => {
    function onStorage(e) {
      if (e.key === AUTH_USER_KEY) {
        setAuthUser(getStoredAuthUser());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const userName = useMemo(() => {
    const n = authUser?.name ? String(authUser.name).trim() : "";
    if (n) return n;
    const email = authUser?.email ? String(authUser.email).trim() : "";
    return email || "Usuário";
  }, [authUser]);

  const userEmail = useMemo(() => {
    const email = authUser?.email ? String(authUser.email).trim() : "";
    return email || "";
  }, [authUser]);

  // ✅ Company/role ainda são mock até termos tenant/backend (/me)
  const userCompany = "GP Labs";
  const userRole = authUser?.role ? String(authUser.role).trim() : "Operador";

  const userInitial = useMemo(() => {
    const s = String(userName || "U").trim();
    return (s[0] || "U").toUpperCase();
  }, [userName]);

  // Fecha o menu ao clicar fora
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleToggleMenu() {
    setIsMenuOpen((prev) => !prev);
  }

  function handleLogoutClick() {
    setIsMenuOpen(false);
    onLogout?.();
  }

  return (
    <header className="topbar">
      <div className="topbar-accent"></div>

      <div className="topbar-inner">
        {/* ESQUERDA */}
        <div className="topbar-left">
          <div className="topbar-logo">
            <img src="/gp-labs-logo.png" alt="GP Labs" />
          </div>

          <div className="topbar-title-block">
            <div className="topbar-app-title">GP Labs Platform</div>
            <div className="topbar-app-subtitle">
              Central de campanhas, atendimento e chatbot
            </div>
          </div>
        </div>

        {/* DIREITA */}
        <div className="topbar-right">
          {/* Botão para sugestões */}
          <button className="ghost-btn" type="button">
            💡 Enviar sugestão
          </button>

          {/* MENU DO USUÁRIO */}
          <div className="user-menu" ref={menuRef}>
            {/* "Pílula" clicável */}
            <button
              type="button"
              className="user-pill user-menu-trigger"
              onClick={handleToggleMenu}
              title={userEmail ? `${userName} • ${userEmail}` : userName}
            >
              <div className="user-avatar">{userInitial}</div>
              <div className="user-meta">
                <div className="user-name">{userName}</div>
                <div className="user-company">
                  {userCompany}
                  {userRole ? ` · ${userRole}` : ""}
                </div>
              </div>
            </button>

            {/* DROPDOWN */}
            <div className={`user-dropdown ${isMenuOpen ? "open" : ""}`}>
              <button
                className="dropdown-item"
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  alert("Em breve: Meu perfil.");
                }}
              >
                👤 Meu perfil
              </button>

              <button
                className="dropdown-item logout"
                type="button"
                onClick={handleLogoutClick}
              >
                🚪 Sair
              </button>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
