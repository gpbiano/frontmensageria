// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";
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

  // ✅ Em PROD garante que senha nunca “vaze” por navegação/hot reload
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(() => {
    return Boolean(email && password && !isSubmitting);
  }, [email, password, isSubmitting]);

  async function handleSubmit(e) {
    e.preventDefault();

    if (!email || !password) {
      setError("Informe seu e-mail e senha para entrar.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const contentType = res.headers.get("content-type") || "";

      if (!contentType.includes("application/json")) {
        const text = await res.text();
        console.error("Resposta NÃO JSON da API de login:", text);
        throw new Error(
          `A API de login não retornou JSON. Verifique se o backend está rodando em ${API_BASE}.`
        );
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "E-mail ou senha inválidos.");
      }

      if (!data?.token || !data?.user) {
        throw new Error("Resposta inválida da API de login.");
      }

      // ✅ Persistência segura (token + user)
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));

      // (opcional futuro)
      // localStorage.setItem("gpLabsRememberMe", rememberMe ? "1" : "0");

      // ✅ Nunca manter senha em memória após login
      setPassword("");

      onLogin?.(data);
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ⚠️ Fallback APENAS em DEV (nunca em produção)
      if (isDev) {
        console.warn(
          "[DEV] Backend indisponível. Usando login de desenvolvimento."
        );
        const fakeData = {
          token: "dev-fallback-token",
          user: {
            id: 0,
            name: "Admin (Dev)",
            email
          }
        };
        localStorage.setItem(AUTH_TOKEN_KEY, fakeData.token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(fakeData.user));
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

        <div className="login-footer">
          Ambiente: <strong>{import.meta.env.MODE}</strong> · API:{" "}
          <code>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}
