// frontend/src/pages/admin/TenantsListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTenantsAdmin } from "../../api/admin.js";
import "../../styles/admin.css";

export default function TenantsListPage() {
  const nav = useNavigate();

  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const resp = await fetchTenantsAdmin();
      const data = resp?.data || resp || {};
      const list = data?.items || data?.tenants || data || [];
      setRows(Array.isArray(list) ? list : []);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Falha ao carregar.";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return rows;

    return rows.filter((t) => {
      const name = String(t?.name || "").toLowerCase();
      const slug = String(t?.slug || "").toLowerCase();
      return name.includes(s) || slug.includes(s);
    });
  }, [rows, q]);

  return (
    <div>
      <div className="admin-header-row">
        <h1 className="admin-h1">Empresas</h1>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={load} disabled={loading}>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>

          <button
            className="admin-primary"
            type="button"
            onClick={() => nav("/admin/cadastros/new")}
          >
            Criar empresa
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label className="admin-label">Buscar</label>
        <input
          className="admin-field"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou slug"
        />
      </div>

      <div className="admin-table">
        <div className="admin-table-head">
          <div>NOME</div>
          <div>SLUG</div>
          <div>STATUS</div>
          <div style={{ textAlign: "right" }}>AÇÕES</div>
        </div>

        {filtered.map((t) => {
          const id = t?.id;
          return (
            <div className="admin-table-row" key={id}>
              <div>{t?.name || "-"}</div>
              <div>{t?.slug || "-"}</div>
              <div>{t?.isActive === false ? "Inativo" : "Ativo"}</div>

              <div style={{ textAlign: "right" }}>
                <button
                  className="admin-link"
                  type="button"
                  onClick={() => nav(`/admin/cadastros/${id}`)}
                >
                  Editar
                </button>
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 14, opacity: 0.7 }}>Nenhuma empresa encontrada.</div>
        )}
      </div>
    </div>
  );
}
