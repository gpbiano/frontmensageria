// frontend/src/LoginPage.jsx
import { useState } from "react";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("admin@gplabs.com.br");
  const [password, setPassword] = useState("gplabs123");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Falha ao conectar ao servidor.");
      }

      if (data?.token) {
        localStorage.setItem("gpLabsAuthToken", data.token);
        rememberMe
          ? localStorage.setItem("gpLabsRememberMe", "true")
          : localStorage.removeItem("gpLabsRememberMe");
      }

      onLogin?.(data);
    } catch (err) {
      setError(err.message || "Não foi possível entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        
        {/* COLUNA ESQUERDA — BRANDING */}
        <div className="login-brand">
          <header className="login-brand-header">
            <div className="login-logo-wrapper">
              <img src="/gp-labs-logo.png" className="login-logo-img" />
              <div className="login-brand-title">
              
                <span className="login-brand-product">GP Labs Platform</span>
              </div>
            </div>
          </header>

          <main className="login-brand-main">
            <h1>Cliente On-line</h1>

            <p>
              Centralize o atendimento digital (WhatsApp, Instagram, Webchat e outros canais)
              em um único painel profissional, com experiência premium.
            </p>

            <ul className="login-brand-highlights">
              <li>✓ Histórico completo em todos os canais</li>
              <li>✓ Envio de campanhas, templates e mídia</li>
              <li>✓ Integrações oficiais com APIs digitais</li>
            </ul>

            <p className="login-brand-footer">
              © 2025 GP Labs
            </p>
          </main>
        </div>

        {/* COLUNA DIREITA – FORMULÁRIO */}
        <div className="login-form-wrapper">
          <header className="login-form-header">
            <span className="login-env-badge">Dev · Local</span>
            <h2>Entrar na plataforma</h2>
            <p>Acesse com suas credenciais de operador.</p>
          </header>

          {error && <div className="login-error">{error}</div>}

          <form className="login-form" onSubmit={handleSubmit}>

            <div className="login-field">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="login-field">
              <label>Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="login-options">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Manter conectado
              </label>

              <button type="button" className="login-link-button">
                Esqueci minha senha
              </button>
            </div>

            <button className="login-submit" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <p className="login-meta-info">
              Versão 1.0.4 · GP Labs Platform – Dev App
            </p>
          </form>
        </div>

      </div>
    </div>
  );
}
