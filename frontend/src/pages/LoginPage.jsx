// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

// ✅ use SEMPRE o client central (api.ts)
import { login as apiLogin } from "../api";

const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

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

  function persistSession({ token, user }) {
    // limpa tudo (evita sessão “misturada”)
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);

    // ✅ GARANTIA: token SEMPRE no localStorage (o api.ts lê ambos, mas isso evita mismatch)
    localStorage.setItem(AUTH_TOKEN_KEY, token);

    // ✅ rememberMe controla apenas onde guardar o USER
    const storage = rememberMe ? localStorage : sessionStorage;
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
      // ✅ LOGIN CENTRALIZADO (api.ts salva token também)
      const data = await apiLogin(email, password);

      if (!data?.token || !data?.user) {
        throw new Error("Resposta inválida da API de login.");
      }

      // ✅ reforço de persistência (rememberMe + user)
      persistSession({ token: data.token, user: data.user });

      setPassword("");
      onLogin?.(data);
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ⚠️ Fallback APENAS em DEV
      if (isDev) {
        console.warn("[DEV] Usando login de fallback.");
        const fakeData = {
          token: "dev-fallback-token",
          user: { id: 0, name: "Admin (Dev)", email }
        };
        persistSession(fakeData);
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
          <code>{import.meta.env.VITE_API_BASE || "http://localhost:3010"}</code>
        </div>
      </div>
    </div>
  );
}

