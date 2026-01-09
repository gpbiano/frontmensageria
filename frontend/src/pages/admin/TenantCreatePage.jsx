// frontend/src/pages/admin/TenantCreatePage.jsx
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTenantAdmin } from "../../api/admin.js";
import "../../styles/admin.css";

function onlyDigits(s) {
  const v = String(s || "").replace(/\D+/g, "");
  return v || "";
}

function fromIsoLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function safeTrim(s) {
  return String(s || "").trim();
}

function trimOrNull(s) {
  const v = safeTrim(s);
  return v ? v : null;
}

export default function TenantCreatePage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Tenant
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Admin user inicial
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");

  // CompanyProfile (opcional)
  const [legalName, setLegalName] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [ie, setIe] = useState("");
  const [im, setIm] = useState("");

  const [postalCode, setPostalCode] = useState("");
  const [address, setAddress] = useState("");
  const [addressNumber, setAddressNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("BR");

  // Billing (opcional)
  const [planCode, setPlanCode] = useState("free");
  const [isFree, setIsFree] = useState(true);
  const [chargeEnabled, setChargeEnabled] = useState(false);
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [preferredMethod, setPreferredMethod] = useState("UNDEFINED");
  const [billingEmail, setBillingEmail] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [graceDaysAfterDue, setGraceDaysAfterDue] = useState(30);

  const canSubmit = useMemo(() => {
    const n = safeTrim(name);
    const s = safeTrim(slug);
    const e = safeTrim(adminEmail).toLowerCase();
    return Boolean(n && s && e.includes("@") && !loading);
  }, [name, slug, adminEmail, loading]);

  async function submit(e) {
    e?.preventDefault?.();
    setErr("");

    const cleanName = safeTrim(name);
    const cleanSlug = safeTrim(slug);
    const cleanEmail = safeTrim(adminEmail).toLowerCase();
    const cleanAdminName = safeTrim(adminName);

    if (!cleanName) return setErr("Informe o nome do tenant.");
    if (!cleanSlug) return setErr("Informe o slug.");
    if (!cleanEmail || !cleanEmail.includes("@")) return setErr("Informe um adminEmail válido.");

    setLoading(true);

    try {
      const payload = {
        tenant: {
          name: cleanName,
          slug: cleanSlug,
          isActive: Boolean(isActive)
        },

        admin: {
          adminEmail: cleanEmail,
          adminName: cleanAdminName ? cleanAdminName : undefined,
          sendInvite: true
        },

        // ✅ tudo opcional (vai como null se vazio)
        companyProfile: {
          legalName: trimOrNull(legalName),
          tradeName: trimOrNull(tradeName),
          cnpj: onlyDigits(cnpj) || null,
          ie: trimOrNull(ie),
          im: trimOrNull(im),

          postalCode: onlyDigits(postalCode) || null,
          address: trimOrNull(address),
          addressNumber: trimOrNull(addressNumber),
          complement: trimOrNull(complement),
          province: trimOrNull(province),
          city: trimOrNull(city),
          state: trimOrNull(state),
          country: safeTrim(country || "BR") || "BR"
        },

        billing: {
          planCode: safeTrim(planCode || "free") || "free",
          isFree: Boolean(isFree),
          chargeEnabled: Boolean(chargeEnabled),
          billingCycle: String(billingCycle || "MONTHLY"),
          preferredMethod: String(preferredMethod || "UNDEFINED"),
          billingEmail: trimOrNull(billingEmail),
          trialEndsAt: fromIsoLocalInput(trialEndsAt),
          graceDaysAfterDue: Number(graceDaysAfterDue || 30)
        }
      };

      const resp = await createTenantAdmin(payload);
      const data = resp?.data || resp || {};
      const id = data?.tenant?.id || data?.id;

      if (id) nav(`/admin/cadastros/${id}`);
      else nav("/admin/cadastros");
    } catch (e2) {
      const msg =
        e2?.response?.data?.error ||
        e2?.response?.data?.message ||
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
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <h1 className="admin-h1" style={{ margin: 0 }}>
            Criar Empresa
          </h1>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            Crie o tenant e defina o admin inicial. Os campos de perfil/billing são opcionais.
          </div>
        </div>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={() => nav("/admin/cadastros")} disabled={loading}>
            Voltar
          </button>

          <button className="admin-primary" type="button" onClick={submit} disabled={!canSubmit}>
            {loading ? "Criando..." : "Criar"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      <form className="admin-form" onSubmit={submit}>
        <div className="admin-section-title">Dados do tenant</div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Nome do tenant</label>
            <input className="admin-field" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>

          <div>
            <label className="admin-label">Slug</label>
            <input className="admin-field" value={slug} onChange={(e) => setSlug(e.target.value)} />
          </div>
        </div>

        <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
          <label className="admin-label" style={{ margin: 0 }}>
            Ativo
          </label>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            {isActive ? "Ativo (cliente poderá acessar ao finalizar)" : "Inativo (cria já bloqueado)"}
          </span>
        </div>

        <div className="admin-section-title">Admin inicial</div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Admin e-mail</label>
            <input
              className="admin-field"
              value={adminEmail}
              onChange={(e) => setAdminEmail(e.target.value)}
              autoComplete="email"
              inputMode="email"
              placeholder="admin@empresa.com.br"
            />
          </div>

          <div>
            <label className="admin-label">Admin nome (opcional)</label>
            <input className="admin-field" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
          </div>
        </div>

        <div className="admin-section-title">Perfil da empresa (opcional)</div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Razão Social</label>
            <input className="admin-field" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">Nome Fantasia</label>
            <input className="admin-field" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
          </div>
        </div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">CNPJ</label>
            <input className="admin-field" value={cnpj} onChange={(e) => setCnpj(e.target.value)} placeholder="Somente números" />
          </div>
          <div>
            <label className="admin-label">IE</label>
            <input className="admin-field" value={ie} onChange={(e) => setIe(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">IM</label>
            <input className="admin-field" value={im} onChange={(e) => setIm(e.target.value)} />
          </div>
        </div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">CEP</label>
            <input className="admin-field" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Somente números" />
          </div>
          <div>
            <label className="admin-label">Número</label>
            <input className="admin-field" value={addressNumber} onChange={(e) => setAddressNumber(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">Complemento</label>
            <input className="admin-field" value={complement} onChange={(e) => setComplement(e.target.value)} />
          </div>
        </div>

        <div className="full">
          <label className="admin-label">Endereço</label>
          <input className="admin-field" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>

        <div className="admin-grid-4">
          <div>
            <label className="admin-label">Bairro</label>
            <input className="admin-field" value={province} onChange={(e) => setProvince(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">Cidade</label>
            <input className="admin-field" value={city} onChange={(e) => setCity(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">UF</label>
            <input className="admin-field" value={state} onChange={(e) => setState(e.target.value)} />
          </div>
          <div>
            <label className="admin-label">País</label>
            <input className="admin-field" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>
        </div>

        <div className="admin-section-title">Billing (opcional)</div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">Plano</label>
            <input className="admin-field" value={planCode} onChange={(e) => setPlanCode(e.target.value)} />
          </div>

          <div>
            <label className="admin-label">Ciclo</label>
            <select className="admin-field" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
              <option value="MONTHLY">Mensal</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="YEARLY">Anual</option>
            </select>
          </div>

          <div>
            <label className="admin-label">Método</label>
            <select className="admin-field" value={preferredMethod} onChange={(e) => setPreferredMethod(e.target.value)}>
              <option value="UNDEFINED">Indefinido</option>
              <option value="BOLETO">Boleto</option>
              <option value="PIX">Pix</option>
              <option value="CREDIT_CARD">Cartão</option>
            </select>
          </div>
        </div>

        <div className="admin-grid-3">
          <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
            <label className="admin-label" style={{ margin: 0 }}>
              Is Free
            </label>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          </div>

          <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
            <label className="admin-label" style={{ margin: 0 }}>
              Cobrança habilitada
            </label>
            <input type="checkbox" checked={chargeEnabled} onChange={(e) => setChargeEnabled(e.target.checked)} />
          </div>

          <div>
            <label className="admin-label">Grace days</label>
            <input
              className="admin-field"
              type="number"
              min="0"
              value={graceDaysAfterDue}
              onChange={(e) => setGraceDaysAfterDue(Number(e.target.value || 0))}
            />
          </div>
        </div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">E-mail de cobrança</label>
            <input className="admin-field" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
          </div>

          <div>
            <label className="admin-label">Trial ends at</label>
            <input
              className="admin-field"
              type="datetime-local"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="full admin-row" style={{ gap: 10 }}>
          <button className="admin-primary" disabled={!canSubmit} type="submit">
            {loading ? "Criando..." : "Criar"}
          </button>

          <button
            className="admin-link"
            type="button"
            onClick={() => nav("/admin/cadastros")}
            disabled={loading}
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
