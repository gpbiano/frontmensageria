// frontend/src/routes/adminRoutes.jsx
import { Routes, Route, Navigate } from "react-router-dom";

import AdminPage from "../pages/admin/AdminPage.jsx";

// Cadastros (Tenants)
import TenantsListPage from "../pages/admin/TenantsListPage.jsx";
import TenantCreatePage from "../pages/admin/TenantCreatePage.jsx";
import TenantDetailPage from "../pages/admin/TenantDetailPage.jsx";

/**
 * AdminRoutes
 * - Mantém tudo dentro de /admin
 * - Default: /admin -> /admin/cadastros
 * - Compat: /admin/tenants* -> /admin/cadastros*
 * - Fallback: qualquer rota desconhecida -> /admin/cadastros
 *
 * Observação importante:
 * - As rotas abaixo são de FRONT (UI).
 * - O backend (API) continua em /admin/tenants (como você mostrou).
 * - A UI pode continuar usando /admin/cadastros por convenção/UX sem problema,
 *   desde que o client (api/admin.js) aponte para o base certo no backend.
 */
export default function AdminRoutes() {
  return (
    <Routes>
      {/* =======================================================
          BLOCO PRINCIPAL /admin
      ======================================================= */}
      <Route path="/admin" element={<AdminPage />}>
        {/* Default do admin */}
        <Route index element={<Navigate to="/admin/cadastros" replace />} />

        {/* Páginas "em breve" */}
        <Route path="dashboard" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="financeiro" element={<div style={{ padding: 10 }}>Em breve</div>} />
        <Route path="monitor" element={<div style={{ padding: 10 }}>Em breve</div>} />

        {/* =======================================================
            Cadastros (Tenants)
        ======================================================= */}
        <Route path="cadastros" element={<TenantsListPage />} />
        <Route path="cadastros/new" element={<TenantCreatePage />} />
        <Route path="cadastros/:id" element={<TenantDetailPage />} />

        {/* =======================================================
            Compat legado (/admin/tenants -> /admin/cadastros)
        ======================================================= */}
        <Route path="tenants" element={<Navigate to="/admin/cadastros" replace />} />
        <Route path="tenants/new" element={<Navigate to="/admin/cadastros/new" replace />} />
        <Route path="tenants/:id" element={<Navigate to="/admin/cadastros/:id" replace />} />

        {/* Fallback dentro do bloco /admin */}
        <Route path="*" element={<Navigate to="/admin/cadastros" replace />} />
      </Route>

      {/* =======================================================
          Qualquer /admin/* fora do bloco acima
      ======================================================= */}
      <Route path="/admin/*" element={<Navigate to="/admin/cadastros" replace />} />
    </Routes>
  );
}
