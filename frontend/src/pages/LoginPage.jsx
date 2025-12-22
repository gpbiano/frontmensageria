// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";
const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

function safeJsonParse(str) {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function decodeJwtPayload(token) {
  try {
    const part = token?.split?.(".")?.[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return safeJsonParse(json);
  } catch {
    return null;
  }
}

async function fetchJson(url, { token, ...options } = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Resposta NÃO JSON (${res.status}) em ${url}: ${text?.slice?.(0, 200) || ""}`
    );
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || "Erro na API.");
  return data;
}

export default function LoginPage({ onLogin }) {
  const isDev = import.meta.env.DEV;

  // ✅ Em DEV facilita testes | em PROD nunca preenche
  const [email, setEmail] = useState(isDev ? "admin@gplabs.com.br" : "");
  const [password, setPassword] = useState(isDev ? "gplabs123" : "");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ Se precisar escolher tenant
  const [tenantOptions, setTenantOptions] = useState([]); // [{id,name}]
  const [pendingLoginData, setPendingLoginData] = useState(null); // { token, user }
  const [selectedTenantId, setSelectedTenantId] = useState("");

  // ✅ Em PROD garante que senha nunca “vaze” por navegação/hot reload
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(() => {
    return Boolean(email && password && !isSubmitting);
  }, [email, password, isSubmitting]);

  function persistSession({ token, user }) {
    const storage = rememberMe ? localStorage : sessionStorage;

    // evita “misturar” sessão entre storages
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);

    storage.setItem(AUTH_TOKEN_KEY, token);
    storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
  }

  async function resolveTenantTokenIfNeeded(loginData) {
    const { token, user } = loginData;

    const payload = decodeJwtPayload(token);
    if (payload?.tenantId) {
      // ✅ já veio completo
      return { token, user };
    }

    // ✅ tentar descobrir tenants do usuário
    // Esperado: { user, tenants:[{id,name,...}], defaultTenantId? }
    let me;
    try {
      me = await fetchJson(`${API_BASE}/auth/me`, { method: "GET", token });
    } catch (e) {
      // se não existir /auth/me ainda, segue pra UI de tenant manual sem opções
      console.warn("Falha ao obter /auth/me para listar tenants:", e);
      me = null;
    }

    const tenantsRaw = me?.tenants || me?.user?.tenants || [];
    const tenants = Array.isArray(tenantsRaw)
      ? tenantsRaw
          .map((t) => ({
            id: t?.id || t?.tenantId || t?.tenant?.id,
            name: t?.name || t?.tenant?.name || t?.label || "Tenant"
          }))
          .filter((t) => Boolean(t.id))
      : [];

    // Se tiver 1 tenant -> auto select
    if (tenants.length === 1) {
      const tenantId = tenants[0].id;
      const sel = await fetchJson(`${API_BASE}/auth/select-tenant`, {
        method: "POST",
        token,
        body: JSON.stringify({ tenantId })
      });

      if (!sel?.token) throw new Error("select-tenant não retornou token.");
      return { token: sel.token, user: sel.user || user };
    }

    // Se tiver vários -> abrir UI pra escolher
    if (tenants.length > 1) {
      setTenantOptions(tenants);
      setSelectedTenantId(tenants[0]?.id || "");
      setPendingLoginData({ token, user });
      throw new Error("SELECIONAR_TENANT");
    }

    // Sem tenants retornados (ou endpoint não existe)
    // -> ainda assim abre UI, mas vazia (usuário não consegue prosseguir)
    setTenantOptions([]);
    setSelectedTenantId("");
    setPendingLoginData({ token, user });
    throw new Error(
      "Seu usuário não possui tenant associado (ou a API /auth/me não está disponível)."
    );
  }

  async function finalizeTenantSelection() {
    if (!pendingLoginData?.token) return;
    if (!selectedTenantId) {
      setError("Selecione um tenant para continuar.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const sel = await fetchJson(`${API_BASE}/auth/select-tenant`, {
        method: "POST",
        token: pendingLoginData.token,
        body: JSON.stringify({ tenantId: selectedTenantId })
      });

      if (!sel?.token) throw new Error("select-tenant não retornou token.");

      const finalData = {
        token: sel.token,
        user: sel.user || pendingLoginData.user
      };

      persistSession(finalData);
      setPassword("");
      setPendingLoginData(null);
      setTenantOptions([]);
      setSelectedTenantId("");

      onLogin?.(finalData);
    } catch (err) {
      console.error("Erro ao selecionar tenant:", err);
      setError(err.message || "Não foi possível selecionar o tenant.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (!email || !password) {
      setError("Informe seu e-mail e senha para entrar.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const data = await fetchJson(`${API_BASE}/login`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (!data?.token || !data?.user) {
        throw new Error("Resposta inválida da API de login.");
      }

      // ✅ garante token com tenantId (evita 401: Token sem tenantId)
      const finalData = await resolveTenantTokenIfNeeded({
        token: data.token,
        user: data.user
      });

      // ✅ Persistência segura (token + user)
      persistSession({ token: finalData.token, user: finalData.user });

      // ✅ Nunca manter senha em memória após login
      setPassword("");

      onLogin?.(finalData);
    } catch (err) {
      // Tratamento especial: abrimos a UI de tenant (não é erro de verdade)
      if (err?.message === "SELECIONAR_TENANT") {
        // UI já foi aberta pelo resolveTenantTokenIfNeeded
        return;
      }

      console.error("Erro ao logar:", err);

      // ⚠️ Fallback APENAS em DEV (nunca em produção)
      if (isDev) {
        console.warn("[DEV] Backend indisponível. Usando login de desenvolvimento.");
        console.warn(
          "[DEV] Atenção: esse token fake NÃO terá tenantId e rotas protegidas vão retornar 401."
        );
        const fakeData = {
          token: "dev-fallback-token",
          user: { id: 0, name: "Admin (Dev)", email }
        };
        persistSession({ token: fakeData.token, user: fakeData.user });
        onLogin?.(fakeData);
      } else {
        setError(
          err.message?.includes("Failed to fetch") ||
            err.message?.includes("NetworkError")
            ? "Não foi possível conectar ao servidor. Tente novamente."
            : err.message || "Não foi possível entrar. Tente novamente."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  // ✅ Se está aguardando seleção de tenant, mostra a tela dentro do card
  const showTenantPicker = Boolean(pendingLoginData);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/gp-labs-logo.png" alt="GP Labs" className="login-logo" />
          <div className="login-title">
            Cliente <span>OnLine</span>
          </div>
        </div>

        <div className="login-subtitle">
          {showTenantPicker
            ? "Selecione o tenant para continuar."
            : "Acesse com suas credenciais de operador."}
        </div>

        {error && <div className="login-error">{error}</div>}

        {!showTenantPicker ? (
          <form className="login-form" onSubmit={handleSubmit} autoComplete="on">
            <label className="login-label">
              E-mail
              <input
                type="email"
                className="login-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                name="username"
                autoComplete="username"
                inputMode="email"
                spellCheck={false}
              />
            </label>

            <label className="login-label">
              Senha
              <input
                type="password"
                className="login-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                name="password"
                autoComplete="current-password"
              />
            </label>

            <div className="login-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Manter conectado</span>
              </label>

              <button
                type="button"
                className="login-link"
                onClick={() =>
                  alert("Fluxo de recuperação de senha ainda não implementado.")
                }
              >
                Esqueci minha senha
              </button>
            </div>

            <button type="submit" className="login-submit" disabled={!canSubmit}>
              {isSubmitting ? (
                <span className="btn-loading">
                  <span className="btn-spinner" aria-hidden="true" />
                  Entrando...
                </span>
              ) : (
                "Entrar"
              )}
            </button>
          </form>
        ) : (
          <div className="login-form">
            <label className="login-label">
              Tenant
              <select
                className="login-input"
                value={selectedTenantId}
                onChange={(e) => setSelectedTenantId(e.target.value)}
                disabled={isSubmitting}
              >
                {tenantOptions.length === 0 ? (
                  <option value="">Nenhum tenant disponível</option>
                ) : (
                  tenantOptions.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))
                )}
              </select>
            </label>

            <button
              type="button"
              className="login-submit"
              onClick={finalizeTenantSelection}
              disabled={isSubmitting || !selectedTenantId}
            >
              {isSubmitting ? (
                <span className="btn-loading">
                  <span className="btn-spinner" aria-hidden="true" />
                  Confirmando...
                </span>
              ) : (
                "Continuar"
              )}
            </button>

            <button
              type="button"
              className="login-link"
              style={{ marginTop: 10 }}
              onClick={() => {
                // cancelar e voltar pro login
                setPendingLoginData(null);
                setTenantOptions([]);
                setSelectedTenantId("");
                setError("");
              }}
              disabled={isSubmitting}
            >
              Voltar
            </button>
          </div>
        )}

        <div className="login-footer">
          Ambiente: <strong>{import.meta.env.MODE}</strong> · API:{" "}
          <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}
