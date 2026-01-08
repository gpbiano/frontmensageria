// frontend/src/pages/admin/AdminPage.jsx
import { Link, useLocation } from "react-router-dom";
import "../../styles/admin.css";

function cx(...arr) {
  return arr.filter(Boolean).join(" ");
}

function CardLink({ to, title, subtitle, disabled }) {
  if (disabled) {
    return (
      <div
        className={cx("admin-card-link", "is-disabled")}
        style={{
          border: "1px solid #e5e7eb",
          borderRadius: 14,
          padding: 16,
          background: "#f3f4f6",
          opacity: 0.7,
          cursor: "not-allowed",
          userSelect: "none"
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
        {subtitle ? (
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>{subtitle}</div>
        ) : null}
        <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, opacity: 0.8 }}>
          Em breve
        </div>
      </div>
    );
  }

  return (
    <Link
      to={to}
      className="admin-card-link"
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        border: "1px solid #e5e7eb",
        borderRadius: 14,
        padding: 16,
        background: "#f8fafc"
      }}
    >
      <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
      {subtitle ? (
        <div style={{ marginTop: 6, fontSize: 13, opacity: 0.75 }}>{subtitle}</div>
      ) : null}
      <div style={{ marginTop: 10, fontSize: 12, fontWeight: 700, opacity: 0.7 }}>
        Abrir →
      </div>
    </Link>
  );
}

export default function AdminPage() {
  const loc = useLocation();
  const path = String(loc.pathname || "");

  return (
    <div style={{ padding: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Administração</h1>
          <div style={{ marginTop: 6, fontSize: 13, opacity: 0.7 }}>
            Acesso Super Admin • {path}
          </div>
        </div>
      </div>

      <div
        style={{
          marginTop: 16,
          display: "grid",
          gridTemplateColumns: "320px 1fr",
          gap: 16,
          alignItems: "start"
        }}
      >
        {/* coluna "menu" da esquerda (cards grandes) */}
        <div
          style={{
            background: "#e5e7eb",
            borderRadius: 16,
            padding: 14
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div
              style={{
                fontSize: 18,
                fontWeight: 800,
                padding: 14,
                borderRadius: 14,
                background: "#eef2f7",
                border: "1px solid rgba(0,0,0,0.05)"
              }}
            >
              Administração
            </div>

            <CardLink
              to="/admin/dashboard"
              title="Dashboard"
              subtitle="Resumo (em breve)"
              disabled={false}
            />

            <CardLink
              to="/admin/tenants"
              title="Cadastros"
              subtitle="Empresas (Tenants) • ver, criar, editar e deletar"
              disabled={false}
            />

            <CardLink
              to="/admin/financeiro"
              title="Financeiro"
              subtitle="Billing / Asaas (em breve)"
              disabled={true}
            />

            <CardLink
              to="/admin/monitor"
              title="Monitor"
              subtitle="Saúde / logs (em breve)"
              disabled={true}
            />
          </div>
        </div>

        {/* coluna de conteúdo */}
        <div
          style={{
            background: "#e5e7eb",
            borderRadius: 16,
            minHeight: 520
          }}
        />
      </div>
    </div>
  );
}
