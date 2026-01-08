// frontend/src/pages/admin/TenantDetailPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchTenant,
  updateTenant,
  updateTenantBilling,
  bootstrapTenant,
  syncTenantBilling
} from "../../api/admin";

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

function Field({ label, value }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value || "-"}</div>
    </div>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams();
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState(null);
  const [companyProfile, setCompanyProfile] = useState(null);
  const [billing, setBilling] = useState(null);
  const [members, setMembers] = useState([]);

  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const [edit, setEdit] = useState({
    name: "",
    slug: "",
    isActive: true
  });

  const [billEdit, setBillEdit] = useState({
    planCode: "free",
    isFree: true,
    chargeEnabled: false,
    pricingRef: "",
    billingEmail: "",
    asaasGroupName: "",
    asaasCustomerAccountGroup: ""
  });

  async function load() {
    setLoading(true);
    const { data } = await fetchTenant(id);
    setTenant(data.tenant);
    setCompanyProfile(data.companyProfile);
    setBilling(data.billing);
    setMembers(data.members || []);

    setEdit({
      name: data.tenant?.name || "",
      slug: data.tenant?.slug || "",
      isActive: Boolean(data.tenant?.isActive)
    });

    setBillEdit({
      planCode: data.billing?.planCode || "free",
      isFree: Boolean(data.billing?.isFree),
      chargeEnabled: Boolean(data.billing?.chargeEnabled),
      pricingRef: data.billing?.pricingRef || "",
      billingEmail: data.billing?.billingEmail || "",
      asaasGroupName: data.billing?.asaasGroupName || "",
      asaasCustomerAccountGroup: data.billing?.asaasCustomerAccountGroup || ""
    });

    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const billingStatus = billing?.status || "-";
  const planLabel = useMemo(() => {
    const p = billEdit.planCode || billing?.planCode || "-";
    return p;
  }, [billEdit.planCode, billing?.planCode]);

  if (loading) return <div style={{ padding: 24 }}>Carregando...</div>;
  if (!tenant) return <div style={{ padding: 24 }}>Tenant não encontrado</div>;

  async function saveTenant() {
    try {
      setSaving(true);
      await updateTenant(id, {
        name: edit.name,
        slug: edit.slug,
        isActive: edit.isActive
      });
      await load();
      alert("Tenant atualizado ✅");
    } catch (e) {
      alert("Falha ao salvar tenant");
    } finally {
      setSaving(false);
    }
  }

  async function saveBilling() {
    try {
      setSaving(true);

      const payload = {
        planCode: billEdit.planCode || null,
        isFree: Boolean(billEdit.isFree),
        chargeEnabled: Boolean(billEdit.chargeEnabled),
        pricingRef: billEdit.pricingRef || null,
        billingEmail: billEdit.billingEmail || null,
        asaasGroupName: billEdit.asaasGroupName || null,
        asaasCustomerAccountGroup: billEdit.asaasCustomerAccountGroup || null
      };

      // regra: se free, não cobra
      if (payload.isFree === true) payload.chargeEnabled = false;

      await updateTenantBilling(id, payload);
      await load();
      alert("Billing atualizado ✅");
    } catch (e) {
      alert("Falha ao salvar billing");
    } finally {
      setSaving(false);
    }
  }

  async function doBootstrap() {
    const ok = window.confirm("Rodar bootstrap do tenant? (idempotente)");
    if (!ok) return;

    try {
      setActionBusy(true);
      await bootstrapTenant(id, { addAdminsToGroup: true });
      await load();
      alert("Bootstrap concluído ✅");
    } catch (e) {
      alert("Falha no bootstrap");
    } finally {
      setActionBusy(false);
    }
  }

  async function doSyncAsaas() {
    const ok = window.confirm(
      "Sincronizar com Asaas? (vai criar Customer se ainda não existir)"
    );
    if (!ok) return;

    try {
      setActionBusy(true);
      await syncTenantBilling(id);
      await load();
      alert("Sync concluído ✅");
    } catch (e) {
      alert("Falha ao sincronizar");
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0 }}>{tenant.name}</h2>
          <div style={{ marginTop: 8 }}>
            <Badge>{tenant.isActive ? "ATIVO" : "INATIVO"}</Badge>
            <Badge>slug: {tenant.slug}</Badge>
            <Badge>plan: {planLabel}</Badge>
            <Badge>billing: {billingStatus}</Badge>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link to="/admin/tenants">← voltar</Link>
          <button disabled={actionBusy} onClick={doBootstrap}>
            Bootstrap
          </button>
          <button disabled={actionBusy} onClick={doSyncAsaas}>
            Sync Asaas
          </button>
        </div>
      </div>

      <hr style={{ margin: "20px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {/* Tenant */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Tenant</h3>

          <div style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Nome</div>
              <input
                value={edit.name}
                onChange={(e) => setEdit((s) => ({ ...s, name: e.target.value }))}
                style={{ width: "100%" }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Slug</div>
              <input
                value={edit.slug}
                onChange={(e) => setEdit((s) => ({ ...s, slug: e.target.value }))}
                style={{ width: "100%" }}
              />
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(edit.isActive)}
                onChange={(e) => setEdit((s) => ({ ...s, isActive: e.target.checked }))}
              />
              <span>Ativo</span>
            </label>

            <button disabled={saving} onClick={saveTenant}>
              Salvar Tenant
            </button>
          </div>
        </div>

        {/* Company */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Empresa (Company Profile)</h3>

          {!companyProfile ? (
            <div style={{ opacity: 0.7 }}>Sem companyProfile (precisa cadastrar)</div>
          ) : (
            <>
              <Field label="Razão Social" value={companyProfile.legalName} />
              <Field label="Nome Fantasia" value={companyProfile.tradeName} />
              <Field label="CNPJ" value={companyProfile.cnpj} />
              <Field label="CEP" value={companyProfile.postalCode} />
              <Field label="Endereço" value={`${companyProfile.address || ""}, ${companyProfile.addressNumber || ""}`} />
              <Field label="Complemento" value={companyProfile.complement} />
              <Field label="Bairro" value={companyProfile.province} />
              <Field label="Cidade/UF" value={`${companyProfile.city || ""} - ${companyProfile.state || ""}`} />
              <Field label="País" value={companyProfile.country} />
            </>
          )}
        </div>

        {/* Billing */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Billing (Asaas)</h3>

          <div style={{ display: "grid", gap: 10 }}>
            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Plan code</div>
              <input
                value={billEdit.planCode}
                onChange={(e) => setBillEdit((s) => ({ ...s, planCode: e.target.value }))}
                style={{ width: "100%" }}
                placeholder="free / starter / pro / enterprise..."
              />
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(billEdit.isFree)}
                onChange={(e) =>
                  setBillEdit((s) => ({
                    ...s,
                    isFree: e.target.checked,
                    chargeEnabled: e.target.checked ? false : s.chargeEnabled
                  }))
                }
              />
              <span>Free (não cria assinatura)</span>
            </label>

            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={Boolean(billEdit.chargeEnabled)}
                disabled={Boolean(billEdit.isFree)}
                onChange={(e) =>
                  setBillEdit((s) => ({ ...s, chargeEnabled: e.target.checked }))
                }
              />
              <span>Charge enabled</span>
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                Pricing ref (campo aberto p/ preço depois)
              </div>
              <input
                value={billEdit.pricingRef}
                onChange={(e) => setBillEdit((s) => ({ ...s, pricingRef: e.target.value }))}
                style={{ width: "100%" }}
                placeholder="ex.: tabela_2026_q1 / priceId / etc"
              />
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Billing email</div>
              <input
                value={billEdit.billingEmail}
                onChange={(e) => setBillEdit((s) => ({ ...s, billingEmail: e.target.value }))}
                style={{ width: "100%" }}
              />
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Asaas group name</div>
              <input
                value={billEdit.asaasGroupName}
                onChange={(e) => setBillEdit((s) => ({ ...s, asaasGroupName: e.target.value }))}
                style={{ width: "100%" }}
                placeholder='ClienteOnline - GP Labs'
              />
            </label>

            <label>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                customerAccountGroup
              </div>
              <input
                value={billEdit.asaasCustomerAccountGroup}
                onChange={(e) =>
                  setBillEdit((s) => ({ ...s, asaasCustomerAccountGroup: e.target.value }))
                }
                style={{ width: "100%" }}
                placeholder="305006"
              />
            </label>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              status: <strong>{billing?.status || "-"}</strong>{" "}
              {billing?.asaasCustomerId ? (
                <>
                  | customerId: <strong>{billing.asaasCustomerId}</strong>
                </>
              ) : null}
            </div>

            <button disabled={saving} onClick={saveBilling}>
              Salvar Billing
            </button>
          </div>
        </div>

        {/* Members */}
        <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Membros</h3>

          {!members?.length ? (
            <div style={{ opacity: 0.7 }}>Sem membros</div>
          ) : (
            <table width="100%" cellPadding={8}>
              <thead>
                <tr>
                  <th align="left">Usuário</th>
                  <th align="left">Role</th>
                  <th align="left">Ativo</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{m.user?.email}</div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>{m.user?.name || "-"}</div>
                    </td>
                    <td>{m.role}</td>
                    <td>{m.isActive ? "sim" : "não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
