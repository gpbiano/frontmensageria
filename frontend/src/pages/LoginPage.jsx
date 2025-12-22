// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

// ✅ mesma regra do backend/api.ts (prioridade: VITE_API_BASE -> VITE_API_BASE_URL -> fallback)
const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  // ✅ fallback PROD (evita cair em localhost por acidente)
  (import.meta.env.MODE === "production"
    ? "https://api.gplabs.com.br"
    : "http://localhost:3010");

const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

async function fetchJson(url, options = {}) {
  const mergedHeaders = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const res = await fetch(url, { ...options, headers: mergedHeaders });

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Resposta inválida da API (${res.status}): ${String(text).slice(0, 200)}`
    );
  }

  const data = await res.json().catch(() => ({}));
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

  // ✅ Em PROD garante que senha nunca “vaze”
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(
    () => Boolean(email && password && !isSubmitting),
    [email, password, isSubmitting]
  );

  function clearSession() {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
  }

  function persistSession({ token, user }) {
    // ✅ evita “mismatch” de token antigo
    clearSession();

    // ✅ REGRA ÚNICA:
    // - se marcar "manter conectado": token + user no localStorage
    // - se não: token + user no sessionStorage
    const storage = rememberMe ? localStorage : sessionStorage;

    storage.setItem(AUTH_TOKEN_KEY, token);
    storage.setItem(AUTH_USER_KEY, JSON.stringify(user));
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

      persistSession({ token: data.token, user: data.user });

      // ✅ sanity check: garante que salvou no storage certo
      const storage = rememberMe ? localStorage : sessionStorage;
      const saved = storage.getItem(AUTH_TOKEN_KEY);

      if (!saved || saved !== data.token) {
        throw new Error(
          "Login ok, mas não consegui salvar o token no navegador (storage bloqueado)."
        );
      }

      // ✅ limpa senha da tela
      setPassword("");

      onLogin?.({ token: data.token, user: data.user });
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ✅ sem fallback (isso causa 401 depois e mascara problema real)
      setError(
        String(err?.message || "").includes("Failed to fetch")
          ? "Não foi possível conectar ao servidor."
          : err?.message || "Não foi possível entrar."
      );

      // ✅ se deu erro, garante limpeza
      clearSession();
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

        <div className="login-subtitle">
          Acesse com suas credenciais de operador.
        </div>

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
                <span className="btn-spinner" />
                Entrando...
              </span>
            ) : (
              "Entrar"
            )}
          </button>
        </form>

        <div className="login-footer">
          Ambiente: <strong>{import.meta.env.MODE}</strong> · API:{" "}
          <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}

