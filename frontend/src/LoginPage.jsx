// frontend/src/LoginPage.jsx
import { useState } from "react";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("admin@gplabs.com.br");
  const [password, setPassword] = useState("gplabs123");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    console.log("🔐 Enviando login...", { email, password: "********" });

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
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json().catch(() => ({}));

      console.log("🔐 Resposta do /login:", res.status, data);

      if (!res.ok) {
        setError(data.error || "Não foi possível fazer login.");
        return;
      }

      localStorage.setItem("gpLabsAuthToken", data.token);
      localStorage.setItem("gpLabsUser", JSON.stringify(data.user || {}));
      if (rememberMe) {
        localStorage.setItem("gpLabsRememberMe", "true");
      } else {
        localStorage.removeItem("gpLabsRememberMe");
      }

      if (onLogin) {
        onLogin(data);
      }
    } catch (err) {
      console.error("❌ Erro ao chamar /login:", err);
      setError("Erro ao conectar ao servidor. Tente novamente.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        {/* Coluna esquerda – branding */}
        <div className="login-brand">
          <div className="login-brand-header">
            <div className="login-logo-wrapper">
              <img
                src="/gp-labs-logo.png"
                alt="GP Labs"
                className="login-logo-img"
              />
              <div className="login-brand-title">
                <span className="login-brand-company">GP LABS</span>
                <span className="login-brand-product">Plataforma WhatsApp</span>
              </div>
            </div>
          </div>

          <div className="login-brand-main">
            <h1>Cliente On-line</h1>
            <p>
              Centralize o atendimento WhatsApp, campanhas e relatórios em um
              único painel profissional.
            </p>

            <ul className="login-brand-highlights">
              <li>✔ Histórico completo de conversas</li>
              <li>✔ Envio de campanhas e templates</li>
              <li>✔ Integração oficial WhatsApp Cloud API</li>
            </ul>
          </div>

          <div className="login-brand-footer">
            <span>© {new Date().getFullYear()} GP Holding Participações</span>
          </div>
        </div>

        {/* Coluna direita – formulário */}
        <div className="login-form-wrapper">
          <div className="login-form-header">
            <span className="login-env-badge">Dev • Local</span>
            <h2>Entrar na plataforma</h2>
            <p>Acesse com suas credenciais de operador.</p>
          </div>

          {/* IMPORTANTE: form com onSubmit={handleSubmit} */}
          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-field">
              <span>E-mail</span>
              <input
                type="email"
                placeholder="voce@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className="login-field">
              <span>Senha</span>
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>

            {error && <div className="login-error">{error}</div>}

            <div className="login-options">
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
                className="login-link-button"
                onClick={() =>
                  alert("Fluxo de recuperação de senha será implementado em breve.")
                }
              >
                Esqueci minha senha
              </button>
            </div>

            {/* IMPORTANTE: type="submit" */}
            <button
              type="submit"
              className="login-submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Entrando..." : "Entrar"}
            </button>
          </form>

          <div className="login-meta-info">
            <span>Versão 1.0.1 • GP Labs – Dev App WhatsApp</span>
          </div>
        </div>
      </div>
    </div>
  );
}
