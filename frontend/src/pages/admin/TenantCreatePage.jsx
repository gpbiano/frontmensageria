// frontend/src/pages/admin/TenantCreatePage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createTenantAdmin } from "../../api/admin.js";
import "../../styles/admin.css";

function safeTrim(s) {
  return String(s || "").trim();
}
function onlyDigits(s) {
  const v = String(s || "").replace(/\D+/g, "");
  return v || "";
}
function slugify(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}
function fromIsoLocalInput(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function trimOrNull(s) {
  const v = safeTrim(s);
  return v ? v : null;
}

export default function TenantCreatePage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // sucesso + fallback link
  const [okMsg, setOkMsg] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");

  // ========= Tenant (router exige flat)
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  // teu POST cria tenant com isActive true fixo
  // (mantemos pra UX e pra evoluir depois caso você adicione isActive no POST)
  const [isActiveUI, setIsActiveUI] = useState(true);

  // ========= Admin inicial (obrigatório)
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");

  // Invite (✅ travado em TRUE pra garantir boas-vindas)
  const sendInvite = true;
  const [inviteTtlDays, setInviteTtlDays] = useState(7);

  // ========= CompanyProfile (opcional, MAS se enviar exige legalName + cnpj)
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

  // ========= Billing (opcional)
  const [planCode, setPlanCode] = useState("free");
  const [isFree, setIsFree] = useState(true);
  const [chargeEnabled, setChargeEnabled] = useState(false);
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [preferredMethod, setPreferredMethod] = useState("UNDEFINED");
  const [billingEmail, setBillingEmail] = useState("");
  const [trialEndsAt, setTrialEndsAt] = useState(""); // backend ignora no POST
  const [graceDaysAfterDue, setGraceDaysAfterDue] = useState(30);

  // ✅ auto slug (useEffect, não useMemo)
  useEffect(() => {
    if (slugTouched) return;
    const s = slugify(name);
    if (s && s !== slug) setSlug(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, slugTouched]);

  // ✅ regra backend: isFree true => chargeEnabled false
  useEffect(() => {
    if (isFree) setChargeEnabled(false);
  }, [isFree]);

  // validações alinhadas ao router
  const requirements = useMemo(() => {
    const missing = [];
    const n = safeTrim(name);
    const s = safeTrim(slug);
    const e = safeTrim(adminEmail).toLowerCase();

    if (!n) missing.push("nome");
    if (!s) missing.push("slug");
    if (!e || !e.includes("@")) missing.push("admin e-mail");

    const hasAnyCompanyField =
      safeTrim(legalName) ||
      safeTrim(tradeName) ||
      safeTrim(cnpj) ||
      safeTrim(ie) ||
      safeTrim(im) ||
      safeTrim(postalCode) ||
      safeTrim(address) ||
      safeTrim(addressNumber) ||
      safeTrim(complement) ||
      safeTrim(province) ||
      safeTrim(city) ||
      safeTrim(state) ||
      safeTrim(country);

    const cleanCnpj = onlyDigits(cnpj);
    const companyOk = !hasAnyCompanyField || (safeTrim(legalName) && cleanCnpj);

    return {
      missing,
      ok: missing.length === 0 && companyOk,
      companyOk,
      hasAnyCompanyField
    };
  }, [
    name,
    slug,
    adminEmail,
    legalName,
    tradeName,
    cnpj,
    ie,
    im,
    postalCode,
    address,
    addressNumber,
    complement,
    province,
    city,
    state,
    country
  ]);

  const canSubmit = requirements.ok && !loading;

  async function submit(e) {
    e?.preventDefault?.();
    setErr("");
    setOkMsg("");
    setInviteToken("");
    setInviteExpiresAt("");

    const cleanName = safeTrim(name);
    const cleanSlug = safeTrim(slug);
    const cleanEmail = safeTrim(adminEmail).toLowerCase();
    const cleanAdminName = safeTrim(adminName);

    if (!cleanName) return setErr("Informe o nome do tenant.");
    if (!cleanSlug) return setErr("Informe o slug.");
    if (!cleanEmail || !cleanEmail.includes("@")) return setErr("Informe um adminEmail válido.");

    // companyProfile: só manda se legalName + cnpj
    const cleanCnpj = onlyDigits(cnpj);
    const hasAnyCompanyField =
      safeTrim(legalName) ||
      safeTrim(tradeName) ||
      safeTrim(cnpj) ||
      safeTrim(ie) ||
      safeTrim(im) ||
      safeTrim(postalCode) ||
      safeTrim(address) ||
      safeTrim(addressNumber) ||
      safeTrim(complement) ||
      safeTrim(province) ||
      safeTrim(city) ||
      safeTrim(state) ||
      safeTrim(country);

    if (hasAnyCompanyField && (!safeTrim(legalName) || !cleanCnpj)) {
      return setErr("Perfil da empresa: para enviar, informe Razão Social e CNPJ (somente números).");
    }

    setLoading(true);

    try {
      // ✅ payload compatível com teu POST /admin/tenants (flat)
      const payload = {
        name: cleanName,
        slug: cleanSlug,
        adminEmail: cleanEmail,
        adminName: cleanAdminName || null,

        // ✅ GARANTIA: sempre pede envio do e-mail de boas-vindas
        sendInvite: true,
        inviteTtlDays: Math.min(30, Math.max(1, Number(inviteTtlDays || 7))),

        companyProfile: hasAnyCompanyField
          ? {
              legalName: safeTrim(legalName),
              tradeName: trimOrNull(tradeName),
              cnpj: cleanCnpj,
              ie: trimOrNull(ie),
              im: trimOrNull(im),

              postalCode: trimOrNull(onlyDigits(postalCode)),
              address: trimOrNull(address),
              addressNumber: trimOrNull(addressNumber),
              complement: trimOrNull(complement),
              province: trimOrNull(province),
              city: trimOrNull(city),
              state: trimOrNull(state),
              country: safeTrim(country || "BR") || "BR"
            }
          : null,

        billing: {
          planCode: safeTrim(planCode || "free") || "free",
          isFree: Boolean(isFree),
          chargeEnabled: Boolean(isFree ? false : chargeEnabled),
          billingCycle: String(billingCycle || "MONTHLY"),
          preferredMethod: String(preferredMethod || "UNDEFINED"),
          billingEmail: trimOrNull(billingEmail),
          trialEndsAt: fromIsoLocalInput(trialEndsAt), // backend ignora hoje
          graceDaysAfterDue: Number(graceDaysAfterDue || 30)
        }
      };

      const resp = await createTenantAdmin(payload);
      const data = resp?.data || resp || {};

      const tenantId = data?.tenant?.id || data?.id || "";
      const token = data?.invite?.token || "";
      const expiresAt = data?.invite?.expiresAt || "";

      // ✅ fallback visível pro superAdmin (se SMTP não estiver ok)
      if (token) setInviteToken(String(token));
      if (expiresAt) setInviteExpiresAt(String(expiresAt));

      setOkMsg(
        "Empresa criada. O convite para definir senha foi solicitado (e-mail de boas-vindas). " +
          "Se o e-mail não chegar, copie o token abaixo e envie o link manualmente."
      );

      // segue fluxo atual
      if (tenantId) {
        nav(`/admin/cadastros/${tenantId}`);
      } else {
        nav("/admin/cadastros");
      }

      // OBS: teu backend cria tenant sempre ativo.
      // se isActiveUI false, você desativa depois no detalhe (ou me pede e eu automatizo via PATCH).
      void isActiveUI;
    } catch (e2) {
      const status = e2?.response?.status;
      const msg =
        e2?.response?.data?.error ||
        e2?.response?.data?.message ||
        e2?.message ||
        "Falha ao criar.";

      // ajuda a debugar 400
      setErr(status ? `[${status}] ${String(msg)}` : String(msg));
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
            Obrigatórios: <strong>nome</strong>, <strong>slug</strong> e <strong>admin e-mail</strong>. •
            O sistema irá <strong>enviar convite de boas-vindas</strong> para criar senha.
            {requirements.hasAnyCompanyField && !requirements.companyOk && (
              <>
                {" "}
                • Perfil da empresa: para enviar, informe <strong>Razão Social</strong> + <strong>CNPJ</strong>.
              </>
            )}
          </div>

          {!requirements.ok && requirements.missing.length > 0 && (
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
        <div style={{ marginBottom: 12 }} className="admin-badge danger">
          {err}
        </div>
      )}

      {okMsg && (
        <div style={{ marginBottom: 12 }} className="admin-badge success" role="status">
          {okMsg}
        </div>
      )}

      {(inviteToken || inviteExpiresAt) && (
        <div style={{ marginBottom: 12, display: "grid", gap: 10 }}>
          {inviteToken && (
            <div>
              <label className="admin-label">Token do convite (fallback)</label>
              <div className="admin-row" style={{ marginTop: 0 }}>
                <input className="admin-field" value={inviteToken} readOnly />
                <button
                  className="admin-link"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteToken);
                      setOkMsg("Token copiado. Você pode enviar o link de criação de senha manualmente.");
                    } catch {
                      // sem drama
                    }
                  }}
                >
                  Copiar
                </button>
              </div>
            </div>
          )}

          {inviteExpiresAt && (
            <div>
              <label className="admin-label">Expira em</label>
              <input className="admin-field" value={inviteExpiresAt} readOnly />
            </div>
          )}
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
          <input type="checkbox" checked={isActiveUI} onChange={(e) => setIsActiveUI(e.target.checked)} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>
            {isActiveUI ? "Ativo (padrão)" : "Inativo (você desativa depois no detalhe)"}
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

        <div className="admin-section-title">Boas-vindas (convite para criar senha)</div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">Enviar convite</label>
            <input className="admin-field" value="Sim (obrigatório)" readOnly />
          </div>

          <div>
            <label className="admin-label">Validade do convite (dias)</label>
            <input
              className="admin-field"
              type="number"
              min="1"
              max="30"
              value={inviteTtlDays}
              onChange={(e) => setInviteTtlDays(Number(e.target.value || 7))}
            />
          </div>

          <div style={{ fontSize: 12, opacity: 0.75 }}>
            O backend cria token e deve enviar e-mail automaticamente.
            Se SMTP falhar, você pode usar o token (fallback).
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
            <input
              className="admin-field"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
              placeholder="Somente números"
            />
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
          <div className="admin-row" style={{ alignItems: "center", gap: 10, marginTop: 0 }}>
            <label className="admin-label" style={{ margin: 0 }}>
              Is Free
            </label>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          </div>

          <div className="admin-row" style={{ alignItems: "center", gap: 10, marginTop: 0 }}>
            <label className="admin-label" style={{ margin: 0 }}>
              Cobrança habilitada
            </label>
            <input
              type="checkbox"
              checked={chargeEnabled}
              disabled={isFree === true}
              onChange={(e) => setChargeEnabled(e.target.checked)}
              title={isFree ? "Free desabilita cobrança automaticamente" : ""}
            />
          </div>

          <div>
            <label className="admin-label">Grace days</label>
            <input
              className="admin-field"
              type="number"
              min="1"
              value={graceDaysAfterDue}
              onChange={(e) => setGraceDaysAfterDue(Number(e.target.value || 30))}
            />
          </div>
        </div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">E-mail de cobrança</label>
            <input className="admin-field" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} />
          </div>

          <div>
            <label className="admin-label">Trial ends at (opcional)</label>
            <input
              className="admin-field"
              type="datetime-local"
              value={trialEndsAt}
              onChange={(e) => setTrialEndsAt(e.target.value)}
            />
          </div>
        </div>

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
