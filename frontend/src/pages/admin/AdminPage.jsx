// frontend/src/pages/admin/AdminPage.jsx
import { Outlet } from "react-router-dom";
import "../../styles/admin.css";

export default function AdminPage() {
  // ✅ Aqui é só o "container" do conteúdo Admin.
  // O menu ESQUERDO já é do App.jsx (sidebar).
  // Então: sem cards, sem menu duplicado, sem fundo diferente.
  return (
    <div className="admin-page">
      <Outlet />
    </div>
  );
}
