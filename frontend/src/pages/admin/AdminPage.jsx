// frontend/src/pages/admin/AdminPage.jsx
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import "../../styles/admin.css";

function isActivePath(pathname, target) {
  return pathname.includes(`/admin/${target}`);
}

export default function AdminPage() {
  const nav = useNavigate();
  const loc = useLocation();

  return (
    <div className="admin-shell">
      <aside className="admin-menu">
        <div className="admin-title">Administração</div>

        <button
          className={`admin-btn ${isActivePath(loc.pathname, "dashboard") ? "active" : ""}`}
          onClick={() => nav("/admin/dashboard")}
          type="button"
        >
          Dashboard
        </button>

        <button
          className={`admin-btn ${isActivePath(loc.pathname, "tenants") ? "active" : ""}`}
          onClick={() => nav("/admin/tenants")}
          type="button"
        >
          Cadastros
        </button>

        <button
          className={`admin-btn ${isActivePath(loc.pathname, "financeiro") ? "active" : ""}`}
          onClick={() => nav("/admin/financeiro")}
          type="button"
        >
          Financeiro
        </button>

        <button
          className={`admin-btn ${isActivePath(loc.pathname, "monitor") ? "active" : ""}`}
          onClick={() => nav("/admin/monitor")}
          type="button"
        >
          Monitor
        </button>
      </aside>

      <main className="admin-content">
        <Outlet />
      </main>
    </div>
  );
}
