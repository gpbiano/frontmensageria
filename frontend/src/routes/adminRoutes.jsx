// frontend/src/routes/adminRoutes.jsx
import { Routes, Route, Navigate } from "react-router-dom";
import TenantsListPage from "../pages/admin/TenantsListPage.jsx";
import TenantCreatePage from "../pages/admin/TenantCreatePage.jsx";
import TenantDetailPage from "../pages/admin/TenantDetailPage.jsx";

export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="/admin" element={<Navigate to="/admin/tenants" replace />} />
      <Route path="/admin/tenants" element={<TenantsListPage />} />
      <Route path="/admin/tenants/new" element={<TenantCreatePage />} />
      <Route path="/admin/tenants/:id" element={<TenantDetailPage />} />
    </Routes>
  );
}
