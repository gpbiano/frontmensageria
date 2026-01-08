// frontend/src/routes/adminRoutes.jsx
import { Routes, Route, Navigate } from "react-router-dom";

// Cadastros (Tenants)
import TenantsListPage from "../pages/admin/TenantsListPage.jsx";
import TenantCreatePage from "../pages/admin/TenantCreatePage.jsx";
import TenantDetailPage from "../pages/admin/TenantDetailPage.jsx";

export default function AdminRoutes() {
  return (
    <Routes>
      {/* ✅ Base Admin */}
      <Route path="/admin" element={<Navigate to="/admin/cadastros" replace />} />

      {/* ✅ Placeholders (em breve) */}
      <Route path="/admin/dashboard" element={<div style={{ padding: 10 }}>Em breve</div>} />
      <Route path="/admin/financeiro" element={<div style={{ padding: 10 }}>Em breve</div>} />
      <Route path="/admin/monitor" element={<div style={{ padding: 10 }}>Em breve</div>} />

      {/* ✅ Cadastros (novo padrão do menu) */}
      <Route path="/admin/cadastros" element={<TenantsListPage />} />
      <Route path="/admin/cadastros/new" element={<TenantCreatePage />} />
      <Route path="/admin/cadastros/:id" element={<TenantDetailPage />} />

      {/* ✅ Compatibilidade com rotas antigas */}
      <Route path="/admin/tenants" element={<Navigate to="/admin/cadastros" replace />} />
      <Route path="/admin/tenants/new" element={<Navigate to="/admin/cadastros/new" replace />} />
      <Route path="/admin/tenants/:id" element={<Navigate to="/admin/cadastros/:id" replace />} />

      {/* fallback */}
      <Route path="/admin/*" element={<Navigate to="/admin/cadastros" replace />} />
    </Routes>
  );
}
