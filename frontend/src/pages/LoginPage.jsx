// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";
const AUTH_KEY = "gpLabsAuthToken";

export default function LoginPage({ onLogin }) {
  const isDev = import.meta.env.DEV;

  // ✅ Em PROD não preenche credenciais
  // ✅ Em DEV pode manter praticidade
  const [email, setEmail] = useState(isDev ? "admin@gplabs.com.br" : "");
  const [password, setPassword] = useState(isDev ? "gplabs123" : "");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ Garante que em produção nunca “sobra” senha (ex: hot reload / navegação)
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(() => {
    return !!email && !!password && !isSubmitting;
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

      if (data?.token) {
        // ✅ token sim; senha jamais
        localStorage.setItem(AUTH_KEY, data.token);

        // (opcional) se no futuro você quiser diferenciar rememberMe:
        // hoje mantemos o mesmo comportamento para evitar regressões
        // localStorage.setItem("gpLabsRememberMe", rememberMe ? "1" : "0");
      }

      // ✅ por segurança: limpa senha após sucesso (principalmente em PROD)
      if (!isDev) setPassword("");

      onLogin?.(data);
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ⚠️ DEV fallback (mantido como estava, mas sem “guardar senha”)
      if (import.meta.env.DEV) {
        console.warn(
          "[DEV] Backend falhou, usando login de desenvolvimento sem validar no servidor."
        );
        const fakeData = {
          token: "dev-fallback-token",
          user: { email, name: "Admin (Dev)" }
        };
        localStorage.setItem(AUTH_KEY, fakeData.token);
        onLogin?.(fakeData);
      } else {
        setError(
          err.message?.includes("Failed to fetch") ||
            err.message?.includes("NetworkError")
            ? "Não foi possível conectar ao servidor. Confira se o backend está rodando."
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

        {/* ✅ Preserva o desenho da página */}
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
              onClick={() => alert("Fluxo de recuperação ainda não implementado.")}
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
