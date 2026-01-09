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
    const base = Array.isArray(rows) ? rows : [];

    const f = !s
      ? base
      : base.filter((t) => {
          const name = String(t?.name || "").toLowerCase();
          const slug = String(t?.slug || "").toLowerCase();
          return name.includes(s) || slug.includes(s);
        });

    // ✅ UX: ordena por nome
    return [...f].sort((a, b) => {
      const an = String(a?.name || "").toLowerCase();
      const bn = String(b?.name || "").toLowerCase();
      return an.localeCompare(bn);
    });
  }, [rows, q]);

  const totalCount = rows?.length || 0;
  const shownCount = filtered?.length || 0;

  return (
    <div>
      <div className="admin-header-row">
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 className="admin-h1" style={{ margin: 0 }}>
            Empresas
          </h1>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {loading ? "Carregando..." : `${shownCount} de ${totalCount} empresas`}
          </div>
        </div>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={load} disabled={loading}>
            {loading ? "Atualizando..." : "Atualizar"}
          </button>

          <button className="admin-primary" type="button" onClick={() => nav("/admin/cadastros/new")}>
            Criar empresa
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      {/* Toolbar (busca) */}
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "flex-end",
          justifyContent: "space-between",
          flexWrap: "wrap",
          marginBottom: 12
        }}
      >
        <div style={{ minWidth: 280, flex: 1 }}>
          <label className="admin-label">Buscar</label>
          <input
            className="admin-field"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por nome ou slug"
          />
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {/* Ação extra (opcional) */}
          <button
            className="admin-link"
            type="button"
            onClick={() => {
              setQ("");
            }}
            disabled={!q || loading}
            title="Limpar busca"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* Lista */}
      <div className="admin-table" role="table" aria-label="Empresas">
        <div className="admin-table-head" role="row">
          <div role="columnheader">NOME</div>
          <div role="columnheader">SLUG</div>
          <div role="columnheader">STATUS</div>
          <div role="columnheader" style={{ textAlign: "right" }}>
            AÇÕES
          </div>
        </div>

        {loading && (
          <div style={{ padding: 14, opacity: 0.75 }}>
            Carregando empresas...
          </div>
        )}

        {!loading &&
          filtered.map((t) => {
            const id = t?.id;
            const active = t?.isActive !== false;

            return (
              <div
                className="admin-table-row"
                role="row"
                key={id}
                style={{ cursor: "pointer" }}
                onClick={() => nav(`/admin/cadastros/${id}`)}
                title="Abrir detalhes"
              >
                <div role="cell" style={{ fontWeight: 700 }}>
                  {t?.name || "-"}
                </div>

                <div role="cell" style={{ opacity: 0.85 }}>
                  {t?.slug || "-"}
                </div>

                <div role="cell">
                  <span
                    className="admin-badge"
                    style={{
                      borderColor: active ? "rgba(22,163,74,0.25)" : "rgba(220,38,38,0.25)",
                      background: active ? "rgba(22,163,74,0.10)" : "rgba(220,38,38,0.10)",
                      color: active ? "rgba(22,163,74,1)" : "rgba(220,38,38,1)"
                    }}
                  >
                    {active ? "Ativo" : "Inativo"}
                  </span>
                </div>

                <div role="cell" style={{ textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
                  <button className="admin-link" type="button" onClick={() => nav(`/admin/cadastros/${id}`)}>
                    Editar
                  </button>
                </div>
              </div>
            );
          })}

        {!loading && filtered.length === 0 && (
          <div style={{ padding: 18, opacity: 0.75 }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Nenhuma empresa encontrada</div>
            <div style={{ fontSize: 13 }}>
              Tente ajustar a busca ou clique em <strong>Criar empresa</strong>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
