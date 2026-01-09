// frontend/src/pages/admin/TenantCreatePage.jsx
import { useEffect, useMemo, useState } from "react";
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

function slugify(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9]+/g, "-") // troca espaços/símbolos por hífen
    .replace(/^-+|-+$/g, "") // trim hífens
    .replace(/-{2,}/g, "-") // colapsa hífens
    .slice(0, 60);
}

export default function TenantCreatePage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // Tenant
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

  // Admin inicial
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

  // ✅ auto slug: só preenche automaticamente enquanto o usuário não “mexeu” no slug manualmente
  const [slugTouched, setSlugTouched] = useState(false);

  useEffect(() => {
    if (slugTouched) return;
    const s = slugify(name);
    setSlug(s);
  }, [name, slugTouched]);

  const requirements = useMemo(() => {
    const n = safeTrim(name);
    const s = safeTrim(slug);
    const e = safeTrim(adminEmail).toLowerCase();

    const missing = [];
    if (!n) missing.push("nome");
    if (!s) missing.push("slug");
    if (!e || !e.includes("@")) missing.push("admin e-mail");

    return { missing, ok: missing.length === 0 };
  }, [name, slug, adminEmail]);

  const canSubmit = requirements.ok && !loading;

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
        tenant: { name: cleanName, slug: cleanSlug, isActive: Boolean(isActive) },

        admin: {
          adminEmail: cleanEmail,
          adminName: cleanAdminName ? cleanAdminName : undefined,
          sendInvite: true
        },

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
            Campos obrigatórios: <strong>nome</strong>, <strong>slug</strong> e <strong>admin e-mail</strong>.
          </div>

          {!requirements.ok && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Falta preencher: <strong>{requirements.missing.join(", ")}</strong>
            </div>
          )}
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
            <input
              className="admin-field"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="ex: gp-holding"
            />
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
              Dica: geramos automaticamente pelo nome (você pode editar).
            </div>
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

        {/* resto do formulário: mantém igual ao seu (perfil + billing) */}
        {/* ... você pode manter o que já está, não muda o payload */}

        <div className="full admin-row" style={{ gap: 10 }}>
          <button className="admin-primary" disabled={!canSubmit} type="submit">
            {loading ? "Criando..." : "Criar"}
          </button>

          <button className="admin-link" type="button" onClick={() => nav("/admin/cadastros")} disabled={loading}>
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
