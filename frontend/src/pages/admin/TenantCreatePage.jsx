// frontend/src/pages/admin/TenantCreatePage.jsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTenant } from "../../api/admin.js";
import "../../styles/admin.css";

export default function TenantCreatePage() {
  const nav = useNavigate();

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const canSubmit = useMemo(() => {
    const n = name.trim();
    const e = adminEmail.trim().toLowerCase();
    return Boolean(n && e.includes("@"));
  }, [name, adminEmail]);

  async function submit(e) {
    e.preventDefault();
    if (loading) return;

    setErr("");

    const cleanName = name.trim();
    const cleanSlug = slug.trim();
    const cleanEmail = adminEmail.trim().toLowerCase();
    const cleanAdminName = adminName.trim();

    if (!cleanName) return setErr("Informe o nome do tenant.");
    if (!cleanEmail || !cleanEmail.includes("@")) return setErr("Informe um adminEmail válido.");

    setLoading(true);

    try {
      const payload = {
        name: cleanName,
        slug: cleanSlug ? cleanSlug : undefined,
        adminEmail: cleanEmail,
        adminName: cleanAdminName ? cleanAdminName : undefined,
        sendInvite: true
      };

      const resp = await createTenant(payload);

      // axios -> resp.data
      const data = resp?.data || resp || {};
      const id = data?.tenant?.id;

      // teus caminhos: /admin/cadastros
      if (id) nav(`/admin/cadastros/${id}`);
      else nav("/admin/cadastros");
    } catch (e2) {
      const msg =
        e2?.response?.data?.detail ||
        e2?.response?.data?.message ||
        e2?.response?.data?.error ||
        e2?.message ||
        "Falha ao criar.";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="admin-header-row">
        <h1 className="admin-h1">Novo Tenant</h1>

        <div className="admin-actions">
          <button
            className="admin-link"
            type="button"
            onClick={() => nav("/admin/cadastros")}
          >
            Voltar
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      <form className="admin-form" onSubmit={submit}>
        <div>
          <label className="admin-label">Nome do tenant</label>
          <input
            className="admin-field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex.: Empresa X"
            autoFocus
          />
        </div>

        <div>
          <label className="admin-label">Slug (opcional)</label>
          <input
            className="admin-field"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="Ex.: empresa-x"
          />
        </div>

        <div>
          <label className="admin-label">Admin e-mail</label>
          <input
            className="admin-field"
            value={adminEmail}
            onChange={(e) => setAdminEmail(e.target.value)}
            placeholder="admin@empresa.com.br"
            autoComplete="email"
            inputMode="email"
          />
        </div>

        <div>
          <label className="admin-label">Admin nome (opcional)</label>
          <input
            className="admin-field"
            value={adminName}
            onChange={(e) => setAdminName(e.target.value)}
            placeholder="Ex.: João Silva"
          />
        </div>

        <div className="full admin-row">
          <button className="admin-primary" disabled={!canSubmit || loading} type="submit">
            {loading ? "Criando..." : "Criar"}
          </button>
        </div>
      </form>
    </div>
  );
}
