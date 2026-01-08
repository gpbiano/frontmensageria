// frontend/src/pages/admin/TenantsListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listTenants, deleteTenant } from "../../api/admin";

function Badge({ children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        border: "1px solid #ddd",
        borderRadius: 999,
        fontSize: 12
      }}
    >
      {children}
    </span>
  );
}

export default function TenantsListPage() {
  const nav = useNavigate();

  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);

  async function load() {
    setLoading(true);
    try {
      // backend aceita page/pageSize/q
      const { data } = await listTenants({ page: 1, pageSize: 50, q: q || "" });
      setItems(data?.items || []);
      setTotal(Number(data?.total || 0));
    } catch (e) {
      alert("Falha ao listar tenants");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => items || [], [items]);

  async function onDelete(t) {
    const ok = window.confirm(
      `Tem certeza que deseja deletar o tenant "${t?.name}"?\n\nEssa ação pode apagar dados (cascade).`
    );
    if (!ok) return;

    try {
      await deleteTenant(t.id);
      await load();
      alert("Tenant deletado ✅");
    } catch (e) {
      alert("Falha ao deletar tenant");
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Cadastros</h2>
          <div style={{ marginTop: 6, opacity: 0.75, fontSize: 13 }}>
            Total: <b>{total}</b> {loading ? "• carregando..." : ""}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            placeholder="Buscar por nome ou slug..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ padding: 8, minWidth: 280 }}
          />
          <button onClick={load} disabled={loading}>
            Buscar
          </button>
          <button onClick={() => nav("/admin/tenants/new")}>+ Novo</button>
        </div>
      </div>

      <hr style={{ margin: "16px 0" }} />

      {loading ? (
        <div>Carregando...</div>
      ) : !filtered.length ? (
        <div style={{ opacity: 0.7 }}>Nenhum tenant encontrado.</div>
      ) : (
        <table width="100%" cellPadding={10} style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #eee" }}>
              <th>Nome</th>
              <th>Slug</th>
              <th>Status</th>
              <th>Plano</th>
              <th>Billing</th>
              <th style={{ width: 260 }}>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => {
              const b = t?.billing || null;

              return (
                <tr key={t.id} style={{ borderBottom: "1px solid #f2f2f2" }}>
                  <td style={{ fontWeight: 600 }}>{t.name}</td>
                  <td>{t.slug}</td>
                  <td>
                    <Badge>{t.isActive ? "ATIVO" : "INATIVO"}</Badge>
                  </td>
                  <td>
                    <Badge>{b?.planCode || "-"}</Badge>
                  </td>
                  <td>
                    <Badge>{b?.status || "-"}</Badge>
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => nav(`/admin/tenants/${t.id}`)}>Editar</button>
                      <button onClick={() => onDelete(t)} style={{ color: "#b00020" }}>
                        Deletar
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
