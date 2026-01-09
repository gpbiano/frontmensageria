// frontend/src/pages/admin/TenantDetailPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchTenantAdmin, updateTenantAdmin, deleteTenantAdmin } from "../../api/admin.js";
import "../../styles/admin.css";

function onlyDigits(s) {
  const v = String(s || "").replace(/\D+/g, "");
  return v || "";
}

function toIsoLocalInput(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}`;
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

export default function TenantDetailPage() {
  const nav = useNavigate();
  const params = useParams();
  const id = String(params?.id || "").trim();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // =============================
  // Form (editável)
  // =============================
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

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

  // =============================
  // Regras internas / automático (read-only)
  // =============================
  const [accessStatus, setAccessStatus] = useState("");
  const [lastPaymentStatus, setLastPaymentStatus] = useState("");
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState("");
  const [lastBankSlipUrl, setLastBankSlipUrl] = useState("");
  const [lastPixQrCode, setLastPixQrCode] = useState("");
  const [lastPixPayload, setLastPixPayload] = useState("");
  const [nextChargeDueDate, setNextChargeDueDate] = useState("");

  const payUrl = useMemo(() => {
    return String(lastInvoiceUrl || "").trim() || String(lastBankSlipUrl || "").trim() || "";
  }, [lastInvoiceUrl, lastBankSlipUrl]);

  async function load() {
    if (!id) {
      setErr("ID inválido.");
      return;
    }
    setErr("");
    setOkMsg("");
    setLoading(true);

    try {
      const resp = await fetchTenantAdmin(id);
      const data = resp?.data || resp || {};
      const t = data?.tenant || data;

      setName(String(t?.name || ""));
      setSlug(String(t?.slug || ""));
      setIsActive(t?.isActive !== false);

      const cp = t?.companyProfile || t?.company || t?.profile || null;
      setLegalName(String(cp?.legalName || ""));
      setTradeName(String(cp?.tradeName || ""));
      setCnpj(String(cp?.cnpj || ""));
      setIe(String(cp?.ie || ""));
      setIm(String(cp?.im || ""));
      setPostalCode(String(cp?.postalCode || ""));
      setAddress(String(cp?.address || ""));
      setAddressNumber(String(cp?.addressNumber || ""));
      setComplement(String(cp?.complement || ""));
      setProvince(String(cp?.province || ""));
      setCity(String(cp?.city || ""));
      setState(String(cp?.state || ""));
      setCountry(String(cp?.country || "BR"));

      const b = t?.billing || null;
      setPlanCode(String(b?.planCode || "free"));
      setIsFree(Boolean(b?.isFree ?? true));
      setChargeEnabled(Boolean(b?.chargeEnabled ?? false));
      setBillingCycle(String(b?.billingCycle || "MONTHLY"));
      setPreferredMethod(String(b?.preferredMethod || "UNDEFINED"));
      setBillingEmail(String(b?.billingEmail || ""));
      setTrialEndsAt(toIsoLocalInput(b?.trialEndsAt));
      setGraceDaysAfterDue(Number(b?.graceDaysAfterDue || 30));

      setAccessStatus(String(b?.accessStatus || ""));
      setLastPaymentStatus(String(b?.lastPaymentStatus || ""));
      setLastInvoiceUrl(String(b?.lastInvoiceUrl || ""));
      setLastBankSlipUrl(String(b?.lastBankSlipUrl || ""));
      setLastPixQrCode(String(b?.lastPixQrCode || ""));
      setLastPixPayload(String(b?.lastPixPayload || ""));
      setNextChargeDueDate(String(b?.nextChargeDueDate || ""));
    } catch (e) {
      const msg = e?.response?.data?.error || e?.response?.data?.message || e?.message || "Falha ao carregar.";
      setErr(String(msg));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canSave = useMemo(() => {
    const n = safeTrim(name);
    const s = safeTrim(slug);
    return Boolean(n && s && !saving && !loading && !deleting);
  }, [name, slug, saving, loading, deleting]);

  function buildPayload() {
    return {
      tenant: {
        name: safeTrim(name),
        slug: safeTrim(slug),
        isActive: Boolean(isActive)
      },

      // ✅ opcional: manda null quando vazio (não obriga preenchimento)
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
  }

  async function save(e) {
    e?.preventDefault?.();
    setErr("");
    setOkMsg("");
    setSaving(true);

    try {
      await updateTenantAdmin(id, buildPayload());
      setOkMsg("Salvo com sucesso.");
      await load();
    } catch (e2) {
      const msg = e2?.response?.data?.error || e2?.response?.data?.message || e2?.message || "Falha ao salvar.";
      setErr(String(msg));
    } finally {
      setSaving(false);
    }
  }

  async function disableTenant() {
    // ✅ botão explícito "Desativar" pra evitar erro de operação
    if (!id) return;
    setErr("");
    setOkMsg("");

    const ok = window.confirm(
      "Deseja DESATIVAR este tenant?\n\nIsso bloqueia o acesso do cliente ao sistema (sem apagar dados)."
    );
    if (!ok) return;

    setSaving(true);
    try {
      const payload = buildPayload();
      payload.tenant.isActive = false;
      await updateTenantAdmin(id, payload);
      setOkMsg("Tenant desativado com sucesso.");
      await load();
    } catch (e2) {
      const msg = e2?.response?.data?.error || e2?.response?.data?.message || e2?.message || "Falha ao desativar.";
      setErr(String(msg));
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!id) return;

    setErr("");
    setOkMsg("");

    const confirm1 = window.confirm(
      "Tem certeza que deseja APAGAR esta empresa (tenant)?\n\n⚠️ Isso pode remover dados e acessos. Essa ação pode ser irreversível."
    );
    if (!confirm1) return;

    const phrase = safeTrim(slug);
    const typed = window.prompt(`Para confirmar, digite o SLUG do tenant:\n\n${phrase}`, "");
    if (safeTrim(typed) !== phrase) {
      setErr("Confirmação inválida. Operação cancelada.");
      return;
    }

    setDeleting(true);
    try {
      await deleteTenantAdmin(id);
      nav("/admin/cadastros");
    } catch (e2) {
      const msg = e2?.response?.data?.error || e2?.response?.data?.message || e2?.message || "Falha ao apagar.";
      setErr(String(msg));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <div className="admin-header-row">
        <h1 className="admin-h1">Editar Empresa</h1>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={() => nav("/admin/cadastros")} disabled={saving || deleting}>
            Voltar
          </button>

          <button className="admin-link" type="button" onClick={load} disabled={loading || saving || deleting}>
            Recarregar
          </button>

          <button className="admin-primary" type="button" onClick={save} disabled={!canSave}>
            {saving ? "Salvando..." : "Salvar"}
          </button>

          <button className="admin-danger" type="button" onClick={onDelete} disabled={deleting || saving || loading}>
            {deleting ? "Apagando..." : "Apagar"}
          </button>
        </div>
      </div>

      {loading && <div style={{ marginBottom: 12, opacity: 0.8 }}>Carregando...</div>}

      {err && (
        <div style={{ marginBottom: 12 }} className="admin-badge">
          {err}
        </div>
      )}

      {okMsg && (
        <div style={{ marginBottom: 12 }} className="admin-badge" role="status">
          {okMsg}
        </div>
      )}

      <form className="admin-form" onSubmit={save}>
        {/* DADOS BÁSICOS */}
        <div className="admin-section-title">Dados do tenant</div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Nome do tenant</label>
            <input className="admin-field" value={name} onChange={(e) => setName(e.target.value)} />
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

          <button
            className="admin-link"
            type="button"
            onClick={disableTenant}
            disabled={saving || loading || deleting || !isActive}
            title="Desativa sem apagar dados"
            style={{ marginLeft: 8 }}
          >
            Desativar
          </button>

          <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>
            {isActive ? "Ativo (cliente consegue acessar)" : "Desativado (acesso bloqueado)"}
          </span>
        </div>

        {/* PERFIL DA EMPRESA (OPCIONAL) */}
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

        {/* BILLING (OPCIONAL) */}
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
            <label className="admin-label" style={{ margin: 0 }}>Is Free</label>
            <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
          </div>

          <div className="admin-row" style={{ alignItems: "center", gap: 10 }}>
            <label className="admin-label" style={{ margin: 0 }}>Cobrança habilitada</label>
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
            <input className="admin-field" type="datetime-local" value={trialEndsAt} onChange={(e) => setTrialEndsAt(e.target.value)} />
          </div>
        </div>

        {/* REGRAS INTERNAS (AUTOMÁTICO) */}
        <div className="admin-section-title">Regras internas (automático)</div>

        <div className="admin-grid-3">
          <div>
            <label className="admin-label">Access Status</label>
            <input className="admin-field" value={accessStatus} readOnly />
          </div>

          <div>
            <label className="admin-label">Last Payment Status</label>
            <input className="admin-field" value={lastPaymentStatus} readOnly />
          </div>

          <div>
            <label className="admin-label">Next Charge Due Date</label>
            <input className="admin-field" value={nextChargeDueDate || ""} readOnly />
          </div>
        </div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Invoice URL</label>
            <input className="admin-field" value={lastInvoiceUrl} readOnly />
          </div>
          <div>
            <label className="admin-label">Boleto URL</label>
            <input className="admin-field" value={lastBankSlipUrl} readOnly />
          </div>
        </div>

        {(lastPixQrCode || lastPixPayload) && (
          <div className="full" style={{ marginTop: 10 }}>
            {lastPixQrCode && (
              <div style={{ marginBottom: 10 }}>
                <label className="admin-label">PIX QR Code</label>
                <input className="admin-field" value={lastPixQrCode} readOnly />
              </div>
            )}
            {lastPixPayload && (
              <div>
                <label className="admin-label">PIX Payload</label>
                <input className="admin-field" value={lastPixPayload} readOnly />
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="full admin-row" style={{ gap: 10 }}>
          <button className="admin-primary" disabled={!canSave} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </button>

          <button className="admin-link" type="button" onClick={load} disabled={loading || saving || deleting}>
            Recarregar
          </button>

          <a
            className="admin-link"
            href={payUrl || undefined}
            target={payUrl ? "_blank" : undefined}
            rel={payUrl ? "noreferrer" : undefined}
            onClick={(e) => {
              if (!payUrl) e.preventDefault();
            }}
            title={!payUrl ? "Sem link de pagamento disponível" : "Abrir link de pagamento"}
            style={{
              marginLeft: "auto",
              pointerEvents: payUrl ? "auto" : "none",
              opacity: payUrl ? 1 : 0.45
            }}
          >
            Pagar
          </a>
        </div>
      </form>
    </div>
  );
}
