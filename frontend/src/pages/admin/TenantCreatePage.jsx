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
function trimOrNull(s) {
  const v = safeTrim(s);
  return v ? v : null;
}

export default function TenantCreatePage() {
  const nav = useNavigate();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // sucesso + fallback token/link
  const [okMsg, setOkMsg] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");

  // ========= Tenant
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  // teu backend aceita isActive no POST (isActiveRequested)
  const [isActiveUI, setIsActiveUI] = useState(true);

  // ========= Admin inicial
  const [adminEmail, setAdminEmail] = useState("");
  const [adminName, setAdminName] = useState("");

  // Invite TTL (backend usa para criar token)
  const [inviteTtlDays, setInviteTtlDays] = useState(7);

  // ========= CompanyProfile
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

  // ========= Billing
  const [planCode, setPlanCode] = useState("free");
  const [pricingRef, setPricingRef] = useState(""); // backend aceita (opcional)
  const [isFree, setIsFree] = useState(true);
  const [chargeEnabled, setChargeEnabled] = useState(false);
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [preferredMethod, setPreferredMethod] = useState("UNDEFINED");
  const [billingEmail, setBillingEmail] = useState("");
  const [graceDaysAfterDue, setGraceDaysAfterDue] = useState(30);

  // ✅ slug automático
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

  // ✅ qualidade de vida: se marcar "não free", sugere plano starter se estiver free
  useEffect(() => {
    if (!isFree && safeTrim(planCode).toLowerCase() === "free") setPlanCode("starter");
    if (isFree && safeTrim(planCode).toLowerCase() !== "free") setPlanCode("free");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFree]);

  const companyHasAnyField = useMemo(() => {
    return Boolean(
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
        safeTrim(country)
    );
  }, [
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

  const requirements = useMemo(() => {
    const missing = [];
    const n = safeTrim(name);
    const s = safeTrim(slug);
    const e = safeTrim(adminEmail).toLowerCase();

    if (!n) missing.push("nome");
    if (!s) missing.push("slug");
    if (!e || !e.includes("@")) missing.push("admin e-mail");

    const cleanCnpj = onlyDigits(cnpj);
    const companyOk = !companyHasAnyField || (safeTrim(legalName) && cleanCnpj);

    // ✅ se NÃO for free, a criação no Asaas depende do companyProfile
    // (se criar sem companyProfile, o backend marca billing ERROR company_profile_missing_for_asaas)
    const paidNeedsCompany = isFree === false;
    const paidCompanyOk = !paidNeedsCompany || (safeTrim(legalName) && cleanCnpj);

    return {
      missing,
      ok: missing.length === 0 && companyOk && paidCompanyOk,
      companyOk,
      paidCompanyOk,
      paidNeedsCompany
    };
  }, [name, slug, adminEmail, companyHasAnyField, cnpj, legalName, isFree]);

  const canSubmit = requirements.ok && !loading;

  async function submit(e) {
    e?.preventDefault?.();
    setErr("");
    setOkMsg("");
    setInviteToken("");
    setInviteUrl("");
    setInviteExpiresAt("");

    const cleanName = safeTrim(name);
    const cleanSlug = safeTrim(slug);
    const cleanEmail = safeTrim(adminEmail).toLowerCase();
    const cleanAdminName = safeTrim(adminName);

    if (!cleanName) return setErr("Informe o nome do tenant.");
    if (!cleanSlug) return setErr("Informe o slug.");
    if (!cleanEmail || !cleanEmail.includes("@")) return setErr("Informe um adminEmail válido.");

    const cleanCnpj = onlyDigits(cnpj);

    // Se preenchendo companyProfile, exige razão + cnpj
    if (companyHasAnyField && (!safeTrim(legalName) || !cleanCnpj)) {
      return setErr("Perfil da empresa: para enviar, informe Razão Social e CNPJ (somente números).");
    }

    // Se for plano pago, exige companyProfile também (pra Asaas funcionar)
    if (isFree === false && (!safeTrim(legalName) || !cleanCnpj)) {
      return setErr("Plano pago: informe Razão Social e CNPJ para criar cliente/assinatura no Asaas.");
    }

    setLoading(true);

    try {
      const payload = {
        name: cleanName,
        slug: cleanSlug,
        adminEmail: cleanEmail,
        adminName: cleanAdminName || null,

        // backend aceita
        isActive: Boolean(isActiveUI),

        // backend usa
        inviteTtlDays: Math.min(30, Math.max(1, Number(inviteTtlDays || 7))),

        // companyProfile só manda se tiver válido
        companyProfile:
          (companyHasAnyField || isFree === false) && safeTrim(legalName) && cleanCnpj
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

        // billing é opcional no router, mas ele cria sempre; mandamos completo pro cenário real
        billing: {
          planCode: safeTrim(planCode || (isFree ? "free" : "starter")) || (isFree ? "free" : "starter"),
          pricingRef: trimOrNull(pricingRef),
          isFree: Boolean(isFree),
          chargeEnabled: Boolean(isFree ? false : chargeEnabled),
          billingCycle: String(billingCycle || "MONTHLY"),
          preferredMethod: String(preferredMethod || "UNDEFINED"),
          billingEmail: trimOrNull(billingEmail),
          graceDaysAfterDue: Math.max(1, Number(graceDaysAfterDue || 30))
        }
      };

      const resp = await createTenantAdmin(payload);
      const data = resp?.data || resp || {};

      const tenantId = data?.tenant?.id || data?.id || "";
      const token = data?.invite?.token || "";
      const expiresAt = data?.invite?.expiresAt || "";
      const url = data?.invite?.url || "";

      if (token) setInviteToken(String(token));
      if (expiresAt) setInviteExpiresAt(String(expiresAt));
      if (url) setInviteUrl(String(url));

      // mensagem alinhada ao backend atual (inviteEmail sent_on_payment_webhook)
      // - plano free: acesso ativo e token criado
      // - plano pago: acesso bloqueado até 1º pagamento; e-mail de boas-vindas é disparado no webhook PAID (fluxo atual)
      if (isFree) {
        setOkMsg(
          "Empresa criada (plano FREE). Token de convite gerado. Você pode copiar o link/token abaixo e enviar para o admin criar a senha."
        );
      } else {
        setOkMsg(
          "Empresa criada (plano PAGO). O acesso fica bloqueado até o primeiro pagamento. " +
            "Token de convite gerado; o envio de boas-vindas acontece no webhook de pagamento (PAID)."
        );
      }

      // vai para detalhe (onde você pode editar / sincronizar etc.)
      if (tenantId) nav(`/admin/cadastros/${tenantId}`);
      else nav("/admin/cadastros");
    } catch (e2) {
      const status = e2?.response?.status;
      const msg =
        e2?.response?.data?.error ||
        e2?.response?.data?.message ||
        e2?.message ||
        "Falha ao criar.";
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
            Obrigatórios: <strong>nome</strong>, <strong>slug</strong> e <strong>admin e-mail</strong>.
            {!isFree && (
              <>
                {" "}
                • Plano pago exige <strong>Razão Social</strong> + <strong>CNPJ</strong> para criar no Asaas.
              </>
            )}
          </div>

          {!requirements.ok && requirements.missing.length > 0 && (
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Falta preencher: <strong>{requirements.missing.join(", ")}</strong>
            </div>
          )}

          {requirements.paidNeedsCompany && !requirements.paidCompanyOk && (
            <div style={{ fontSize: 12 }} className="admin-badge danger">
              Plano pago: preencha Razão Social e CNPJ para o Asaas.
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

      {(inviteUrl || inviteToken || inviteExpiresAt) && (
        <div style={{ marginBottom: 12, display: "grid", gap: 10 }}>
          {inviteUrl && (
            <div>
              <label className="admin-label">Link do convite</label>
              <div className="admin-row" style={{ marginTop: 0 }}>
                <input className="admin-field" value={inviteUrl} readOnly />
                <button
                  className="admin-link"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteUrl);
                      setOkMsg("Link copiado.");
                    } catch {
                      // ignore
                    }
                  }}
                >
                  Copiar
                </button>
              </div>
            </div>
          )}

          {inviteToken && (
            <div>
              <label className="admin-label">Token do convite</label>
              <div className="admin-row" style={{ marginTop: 0 }}>
                <input className="admin-field" value={inviteToken} readOnly />
                <button
                  className="admin-link"
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(inviteToken);
                      setOkMsg("Token copiado.");
                    } catch {
                      // ignore
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
              Geramos automaticamente pelo nome (você pode editar).
            </div>
          </div>
        </div>

        <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
          <label className="admin-label" style={{ margin: 0 }}>
            Ativo
          </label>
          <input type="checkbox" checked={isActiveUI} onChange={(e) => setIsActiveUI(e.target.checked)} />
          <span style={{ fontSize: 12, opacity: 0.75 }}>{isActiveUI ? "Cliente habilitado" : "Cliente desativado"}</span>
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

        <div className="admin-section-title">Convite (criar senha)</div>

        <div className="admin-grid-3">
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

          <div style={{ gridColumn: "span 2", fontSize: 12, opacity: 0.75 }}>
            Um token é gerado no backend e o link aparece como fallback aqui.
            {!isFree && <> O envio automático de boas-vindas fica para o webhook de pagamento (PAID), conforme fluxo atual.</>}
          </div>
        </div>

        <div className="admin-section-title">Perfil da empresa {isFree ? "(opcional)" : "(obrigatório para plano pago)"}</div>

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
            <input
              className="admin-field"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="Somente números"
            />
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

        <div className="admin-section-title">Billing (Asaas)</div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">Plano</label>
            <input className="admin-field" value={planCode} onChange={(e) => setPlanCode(e.target.value)} />
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 6 }}>
              Sugestão: <code>free</code>, <code>starter</code>, <code>pro</code> ou valor fixo (ex: <code>1,00</code>).
            </div>
          </div>

          <div>
            <label className="admin-label">Pricing Ref (opcional)</label>
            <input className="admin-field" value={pricingRef} onChange={(e) => setPricingRef(e.target.value)} />
          </div>

          <div>
            <label className="admin-label">Ciclo</label>
            <select className="admin-field" value={billingCycle} onChange={(e) => setBillingCycle(e.target.value)}>
              <option value="MONTHLY">Mensal</option>
              <option value="QUARTERLY">Trimestral</option>
              <option value="YEARLY">Anual</option>
            </select>
          </div>
        </div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">Método preferido</label>
            <select className="admin-field" value={preferredMethod} onChange={(e) => setPreferredMethod(e.target.value)}>
              <option value="UNDEFINED">Indefinido</option>
              <option value="BOLETO">Boleto</option>
              <option value="PIX">Pix</option>
              <option value="CREDIT_CARD">Cartão</option>
            </select>
          </div>

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
        </div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">E-mail de cobrança (opcional)</label>
            <input className="admin-field" value={billingEmail} onChange={(e) => setBillingEmail(e.target.value)} placeholder="financeiro@empresa.com.br" />
          </div>

          <div>
            <label className="admin-label">Grace days (atraso)</label>
            <input
              className="admin-field"
              type="number"
              min="1"
              value={graceDaysAfterDue}
              onChange={(e) => setGraceDaysAfterDue(Number(e.target.value || 30))}
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
