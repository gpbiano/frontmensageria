import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTenants } from "../../api/admin.js";
import "../../styles/admin.css";

export default function TenantsListPage() {
  const nav = useNavigate();

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState([]);

  async function load() {
    setErr("");
    setLoading(true);
    try {
      const resp = await listTenants({ page: 1, pageSize: 50, q: q.trim() });
      const data = resp?.data || {};
      const items = data?.tenants || data?.items || data?.data || [];
      setRows(Array.isArray(items) ? items : []);
    } catch (e) {
      const msg =
        e?.response?.data?.error ||
        e?.response?.data?.message ||
        e?.message ||
        "Falha ao carregar tenants.";
      setErr(String(msg));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
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

        <div className="admin-actions" style={{ gap: 8 }}>
          <button className="admin-link" type="button" onClick={() => load()} disabled={loading}>
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

      <div className="admin-form" style={{ marginBottom: 12 }}>
        <div>
          <label className="admin-label">Buscar</label>
          <input
            className="admin-field"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou slug"
          />
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      {loading ? (
        <div className="admin-badge">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="admin-badge">Nenhuma empresa encontrada.</div>
      ) : (
        <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="admin-table" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 12 }}>Nome</th>
                <th style={{ textAlign: "left", padding: 12 }}>Slug</th>
                <th style={{ textAlign: "left", padding: 12 }}>Status</th>
                <th style={{ textAlign: "right", padding: 12 }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const id = String(t?.id || "");
                const name = String(t?.name || "");
                const slug = String(t?.slug || "");
                const isActive = t?.isActive !== false;

                return (
                  <tr key={id} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                    <td style={{ padding: 12 }}>{name}</td>
                    <td style={{ padding: 12, opacity: 0.85 }}>{slug}</td>
                    <td style={{ padding: 12 }}>
                      <span className="admin-badge" style={{ opacity: 0.9 }}>
                        {isActive ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td style={{ padding: 12, textAlign: "right" }}>
                      <button
                        className="admin-link"
                        type="button"
                        onClick={() => nav(`/admin/cadastros/${id}`)}
                      >
                        Editar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
