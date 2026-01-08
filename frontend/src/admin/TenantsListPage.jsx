// frontend/src/pages/admin/TenantsListPage.jsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchTenants, bootstrapTenant, syncTenantBilling } from "../../api/admin";

function Badge({ children }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        border: "1px solid #ddd",
        borderRadius: 999,
        fontSize: 12,
        marginRight: 8
      }}
    >
      {children}
    </span>
  );
}

export default function TenantsListPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await fetchTenants();
    setItems(data.items || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onBootstrap(id) {
    const ok = window.confirm("Rodar bootstrap deste tenant? (idempotente)");
    if (!ok) return;
    try {
      setBusyId(id);
      await bootstrapTenant(id, { addAdminsToGroup: true });
      await load();
    } finally {
      setBusyId("");
    }
  }

  async function onSync(id) {
    const ok = window.confirm("Sincronizar com Asaas? (cria customer se não existir)");
    if (!ok) return;
    try {
      setBusyId(id);
      await syncTenantBilling(id);
      await load();
    } finally {
      setBusyId("");
    }
  }

  const empty = useMemo(() => !loading && (!items || items.length === 0), [loading, items]);

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>Empresas (Tenants)</h2>
        <Link to="/admin/tenants/new">+ criar empresa</Link>
      </div>

      <div style={{ marginTop: 10, marginBottom: 16, opacity: 0.7, fontSize: 13 }}>
        Ações: Bootstrap (grupo + configs) e Sync Asaas (Customer + grupo).
      </div>

      {loading ? <p>Carregando...</p> : null}
      {empty ? <p>Nenhum tenant encontrado.</p> : null}

      {!loading && items?.length ? (
        <table width="100%" cellPadding={10}>
          <thead>
            <tr>
              <th align="left">Tenant</th>
              <th align="left">Plano</th>
              <th align="left">Billing</th>
              <th align="left">Status</th>
              <th align="left">Ações</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const plan = t.billing?.planCode || "-";
              const billStatus = t.billing?.status || "-";
              const isActive = t.isActive ? "ATIVO" : "INATIVO";
              const busy = busyId === t.id;

              return (
                <tr key={t.id} style={{ borderTop: "1px solid #eee" }}>
                  <td>
                    <div style={{ fontWeight: 700 }}>
                      <Link to={`/admin/tenants/${t.id}`}>{t.name}</Link>
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{t.slug}</div>
                    <div style={{ marginTop: 6 }}>
                      <Badge>id: {t.id.slice(0, 8)}…</Badge>
                    </div>
                  </td>

                  <td>
                    <Badge>{plan}</Badge>
                    {t.billing?.isFree ? <Badge>FREE</Badge> : null}
                    {t.billing?.chargeEnabled ? <Badge>CHARGE ON</Badge> : <Badge>CHARGE OFF</Badge>}
                  </td>

                  <td>
                    <Badge>{billStatus}</Badge>
                    {t.billing?.asaasCustomerId ? (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                        customerId: {String(t.billing.asaasCustomerId).slice(0, 10)}…
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
                        sem customerId
                      </div>
                    )}
                  </td>

                  <td>
                    <Badge>{isActive}</Badge>
                  </td>

                  <td>
                    <button disabled={busy} onClick={() => onBootstrap(t.id)}>
                      Bootstrap
                    </button>
                    <button style={{ marginLeft: 8 }} disabled={busy} onClick={() => onSync(t.id)}>
                      Sync Asaas
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
