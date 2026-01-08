// frontend/src/pages/admin/AdminPage.jsx
import { Outlet } from "react-router-dom";

export default function AdminPage() {
  return (
    <div className="page-full">
      <Outlet />
    </div>
  );
}

