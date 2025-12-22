// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";
const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(
      `Resposta inválida da API (${res.status}): ${text?.slice?.(0, 200) || ""}`
    );
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || data?.message || "Erro na API.");
  return data;
}

function clearAuthStorages() {
  try {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  } catch {}
  try {
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
  } catch {}
}

function persistSession({ token, user }, rememberMe) {
  const storage = rememberMe ? localStorage : sessionStorage;
  const otherStorage = rememberMe ? sessionStorage : localStorage;

  // limpa os dois pra não misturar sessão
  try {
    storage.removeItem(AUTH_TOKEN_KEY);
    storage.removeItem(AUTH_USER_KEY);
  } catch {}
  try {
    otherStorage.removeItem(AUTH_TOKEN_KEY);
    otherStorage.removeItem(AUTH_USER_KEY);
  } catch {}

  // grava no storage escolhido
  storage.setItem(AUTH_TOKEN_KEY, String(token));
  storage.setItem(AUTH_USER_KEY, JSON.stringify(user));

  // (opcional) espelha o token no outro storage também (evita mismatch do app)
  // Se você preferir NÃO espelhar, pode remover as 2 linhas abaixo.
  otherStorage.setItem(AUTH_TOKEN_KEY, String(token));
}

export default function LoginPage({ onLogin }) {
  const isDev = import.meta.env.DEV;

  // ✅ Em DEV facilita testes | em PROD nunca preenche
  const [email, setEmail] = useState(isDev ? "admin@gplabs.com.br" : "");
  const [password, setPassword] = useState(isDev ? "gplabs123" : "");
  const [rememberMe, setRememberMe] = useState(true);

  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ Em PROD garante que senha nunca “vaze”
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(
    () => Boolean(email && password && !isSubmitting),
    [email, password, isSubmitting]
  );

  async function handleSubmit(e) {
    e.preventDefault();

    if (!email || !password) {
      setError("Informe seu e-mail e senha para entrar.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      // sempre limpa sessão antes de tentar logar
      clearAuthStorages();

      const data = await fetchJson(`${API_BASE}/login`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      if (!data?.token || !data?.user) {
        throw new Error("Resposta inválida da API de login (token/user ausente).");
      }

      // ✅ ESSENCIAL: salvar token no storage
      persistSession({ token: data.token, user: data.user }, rememberMe);

      setPassword("");
      onLogin?.({ token: data.token, user: data.user, tenant: data.tenant, tenants: data.tenants });
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ⚠️ Fallback APENAS em DEV
      if (isDev) {
        console.warn("[DEV] Usando login de fallback.");
        const fakeData = {
          token: "dev-fallback-token",
          user: { id: 0, name: "Admin (Dev)", email }
        };
        persistSession(fakeData, rememberMe);
        onLogin?.(fakeData);
      } else {
        setError(
          err?.message?.includes("Failed to fetch")
            ? "Não foi possível conectar ao servidor."
            : err?.message || "Não foi possível entrar."
        );
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <img src="/gp-labs-logo.png" alt="GP Labs" className="login-logo" />
          <div className="login-title">
            Cliente <span>OnLine</span>
          </div>
        </div>

        <div className="login-subtitle">Acesse com suas credenciais de operador.</div>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit} autoComplete="on">
          <label className="login-label">
            E-mail
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
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
              onClick={() => alert("Fluxo de recuperação de senha ainda não implementado.")}
            >
              Esqueci minha senha
            </button>
          </div>

          <button type="submit" className="login-submit" disabled={!canSubmit}>
            {isSubmitting ? (
              <span className="btn-loading">
                <span className="btn-spinner" />
                Entrando...
              </span>
            ) : (
              "Entrar"
            )}
          </button>
        </form>

        <div className="login-footer">
          Ambiente: <strong>{import.meta.env.MODE}</strong> · API: <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}

