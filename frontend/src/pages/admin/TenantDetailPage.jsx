// frontend/src/pages/admin/TenantDetailPage.jsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchTenantAdmin, updateTenantAdmin } from "../../api/admin.js";
import "../../styles/admin.css";

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function toIsoLocalInput(v) {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  // datetime-local precisa sem timezone
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

export default function TenantDetailPage() {
  const nav = useNavigate();
  const params = useParams();

  const id = String(params?.id || "").trim();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  // =============================
  // Form state
  // =============================
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [isActive, setIsActive] = useState(true);

  // CompanyProfile
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

  // Billing
  const [planCode, setPlanCode] = useState("free");
  const [isFree, setIsFree] = useState(true);
  const [chargeEnabled, setChargeEnabled] = useState(false);
  const [billingCycle, setBillingCycle] = useState("MONTHLY");
  const [preferredMethod, setPreferredMethod] = useState("UNDEFINED");
  const [billingEmail, setBillingEmail] = useState("");

  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [graceDaysAfterDue, setGraceDaysAfterDue] = useState(30);

  // read-only mirror
  const [accessStatus, setAccessStatus] = useState("");
  const [lastPaymentStatus, setLastPaymentStatus] = useState("");
  const [lastInvoiceUrl, setLastInvoiceUrl] = useState("");
  const [lastBankSlipUrl, setLastBankSlipUrl] = useState("");
  const [lastPixQrCode, setLastPixQrCode] = useState("");
  const [lastPixPayload, setLastPixPayload] = useState("");
  const [nextChargeDueDate, setNextChargeDueDate] = useState("");

  // “Pagar” link (prioridade)
  const payUrl = useMemo(() => {
    return (
      String(lastInvoiceUrl || "").trim() ||
      String(lastBankSlipUrl || "").trim() ||
      "" // pix normalmente é QR/payload, não URL
    );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const canSave = useMemo(() => {
    const n = String(name || "").trim();
    const s = String(slug || "").trim();
    return Boolean(n && s && !saving && !loading);
  }, [name, slug, saving, loading]);

  async function save(e) {
    e?.preventDefault?.();
    setErr("");
    setOkMsg("");
    setSaving(true);

    try {
      const payload = {
        tenant: {
          name: String(name || "").trim(),
          slug: String(slug || "").trim(),
          isActive: Boolean(isActive)
        },

        companyProfile: {
          legalName: String(legalName || "").trim(),
          tradeName: String(tradeName || "").trim() || null,
          cnpj: onlyDigits(cnpj),
          ie: String(ie || "").trim() || null,
          im: String(im || "").trim() || null,

          postalCode: onlyDigits(postalCode),
          address: String(address || "").trim(),
          addressNumber: String(addressNumber || "").trim(),
          complement: String(complement || "").trim() || null,
          province: String(province || "").trim() || null,
          city: String(city || "").trim() || null,
          state: String(state || "").trim() || null,
          country: String(country || "BR").trim() || "BR"
        },

        billing: {
          planCode: String(planCode || "free").trim() || "free",
          isFree: Boolean(isFree),
          chargeEnabled: Boolean(chargeEnabled),
          billingCycle: String(billingCycle || "MONTHLY"),
          preferredMethod: String(preferredMethod || "UNDEFINED"),
          billingEmail: String(billingEmail || "").trim() || null,
          trialEndsAt: fromIsoLocalInput(trialEndsAt),
          graceDaysAfterDue: Number(graceDaysAfterDue || 30)
        }
      };

      await updateTenantAdmin(id, payload);
      setOkMsg("Salvo com sucesso.");
      await load();
    } catch (e2) {
      const msg =
        e2?.response?.data?.error ||
        e2?.response?.data?.message ||
        e2?.message ||
        "Falha ao salvar.";
      setErr(String(msg));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="admin-header-row">
        <h1 className="admin-h1">Editar Empresa</h1>

        <div className="admin-actions">
          <button className="admin-link" type="button" onClick={() => nav("/admin/cadastros")}>
            Voltar
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
        {/* =============================
            DADOS BÁSICOS
        ============================== */}
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
        </div>

        {/* =============================
            PERFIL DA EMPRESA
        ============================== */}
        <div className="admin-section-title">Perfil da empresa (Fiscal + Endereço)</div>

        <div className="admin-grid-2">
          <div>
            <label className="admin-label">Razão Social</label>
            <input
              className="admin-field"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Razão Social"
            />
          </div>

          <div>
            <label className="admin-label">Nome Fantasia</label>
            <input
              className="admin-field"
              value={tradeName}
              onChange={(e) => setTradeName(e.target.value)}
              placeholder="Nome Fantasia"
            />
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
            <input
              className="admin-field"
              value={addressNumber}
              onChange={(e) => setAddressNumber(e.target.value)}
            />
          </div>

          <div>
            <label className="admin-label">Complemento</label>
            <input
              className="admin-field"
              value={complement}
              onChange={(e) => setComplement(e.target.value)}
            />
          </div>
        </div>

        <div>
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

        {/* =============================
            BILLING
        ============================== */}
        <div className="admin-section-title">Billing (Asaas)</div>

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
            <label className="admin-label">Método preferido</label>
            <select
              className="admin-field"
              value={preferredMethod}
              onChange={(e) => setPreferredMethod(e.target.value)}
            >
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
            <input
              type="checkbox"
              checked={chargeEnabled}
              onChange={(e) => setChargeEnabled(e.target.checked)}
            />
          </div>

          <div>
            <label className="admin-label">Grace days (atraso)</label>
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
            <input
              className="admin-field"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              placeholder="financeiro@empresa.com.br"
            />
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

        {/* Espelho / status */}
        <div className="admin-section-title">Status (espelho)</div>

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
            <input className="admin-field" value={nextChargeDueDate ? String(nextChargeDueDate) : ""} readOnly />
          </div>
        </div>

        {/* ✅ Botão PAGAR (voltou) */}
        <div className="admin-row" style={{ gap: 10, marginTop: 10 }}>
          <button className="admin-primary" disabled={!canSave} type="submit">
            {saving ? "Salvando..." : "Salvar"}
          </button>

          <button className="admin-link" type="button" onClick={load} disabled={loading || saving}>
            Recarregar
          </button>

          <a
            className={"admin-link" + (!payUrl ? " is-disabled" : "")}
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

        {/* Pix info (quando existir) */}
        {(lastPixQrCode || lastPixPayload) && (
          <div style={{ marginTop: 12 }}>
            <div className="admin-section-title">PIX</div>
            {lastPixQrCode && (
              <div style={{ marginBottom: 8 }}>
                <label className="admin-label">QR Code</label>
                <input className="admin-field" value={lastPixQrCode} readOnly />
              </div>
            )}
            {lastPixPayload && (
              <div>
                <label className="admin-label">Payload</label>
                <input className="admin-field" value={lastPixPayload} readOnly />
              </div>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
