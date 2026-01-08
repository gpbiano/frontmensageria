import { useState } from "react";
import { createTenant } from "../../api/admin";

export default function TenantCreatePage() {
  const [form, setForm] = useState({
    name: "",
    adminEmail: "",
    legalName: "",
    cnpj: "",
    postalCode: "",
    address: "",
    addressNumber: ""
  });

  function set(k, v) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function submit() {
    await createTenant({
      name: form.name,
      adminEmail: form.adminEmail,
      companyProfile: {
        legalName: form.legalName,
        cnpj: form.cnpj,
        postalCode: form.postalCode,
        address: form.address,
        addressNumber: form.addressNumber
      },
      billing: {
        planCode: "free",
        isFree: true
      }
    });

    alert("Tenant criado com sucesso");
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>Criar Empresa</h2>

      <input placeholder="Nome" onChange={(e) => set("name", e.target.value)} />
      <input
        placeholder="Email Admin"
        onChange={(e) => set("adminEmail", e.target.value)}
      />

      <h3>Empresa</h3>

      <input
        placeholder="Razão Social"
        onChange={(e) => set("legalName", e.target.value)}
      />
      <input placeholder="CNPJ" onChange={(e) => set("cnpj", e.target.value)} />
      <input
        placeholder="CEP"
        onChange={(e) => set("postalCode", e.target.value)}
      />
      <input
        placeholder="Endereço"
        onChange={(e) => set("address", e.target.value)}
      />
      <input
        placeholder="Número"
        onChange={(e) => set("addressNumber", e.target.value)}
      />

      <br />
      <button onClick={submit}>Criar</button>
    </div>
  );
}
