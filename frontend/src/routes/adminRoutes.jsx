// frontend/src/routes/adminRoutes.jsx
import { Routes, Route, Navigate } from "react-router-dom";

import AdminPage from "../pages/admin/AdminPage.jsx";

// Cadastros (Tenants)
import TenantsListPage from "../pages/admin/TenantsListPage.jsx";
import TenantCreatePage from "../pages/admin/TenantCreatePage.jsx";
import TenantDetailPage from "../pages/admin/TenantDetailPage.jsx";

export default function AdminRoutes() {
  return (
    <Routes>
      {/* ✅ TUDO ABSOLUTO EM /admin */}
      <Route path="/admin" element={<AdminPage />}>
        {/* default */}
        <Route index element={<Navigate to="/admin/cadastros" replace />} />

        {/* páginas */}
        <Route path="dashboard" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="financeiro" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="monitor" element={<div style={{ padding: 10 }}>Em breve</div>} />

        {/* ✅ Cadastros */}
        <Route path="cadastros" element={<TenantsListPage />} />
        <Route path="cadastros/new" element={<TenantCreatePage />} />
        <Route path="cadastros/:id" element={<TenantDetailPage />} />

        {/* compat antigo */}
        <Route path="tenants" element={<Navigate to="/admin/cadastros" replace />} />
        <Route path="tenants/new" element={<Navigate to="/admin/cadastros/new" replace />} />
        <Route path="tenants/:id" element={<Navigate to="/admin/cadastros/:id" replace />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="/admin/cadastros" replace />} />
      </Route>

      {/* ✅ Se alguém cair em /admin/qualquercoisa fora do bloco acima */}
      <Route path="/admin/*" element={<Navigate to="/admin/cadastros" replace />} />
    </Routes>
  );
}
