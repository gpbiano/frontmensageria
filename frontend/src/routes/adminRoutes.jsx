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
      <Route path="/" element={<AdminPage />}>
        {/* default */}
        <Route index element={<Navigate to="tenants" replace />} />

        {/* placeholders (em breve) */}
        <Route path="dashboard" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="financeiro" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="monitor" element={<div style={{ padding: 10 }}>Em breve</div>} />

        {/* ✅ Cadastros */}
        <Route path="tenants" element={<TenantsListPage />} />
        <Route path="tenants/new" element={<TenantCreatePage />} />
        <Route path="tenants/:id" element={<TenantDetailPage />} />

        {/* fallback */}
        <Route path="*" element={<Navigate to="tenants" replace />} />
      </Route>
    </Routes>
  );
}
