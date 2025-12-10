// frontend/src/LoginPage.jsx
import { useState } from "react";
import "./LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function LoginPage({ onLogin }) {
  /* =========================
     STATES
  ========================== */
  const [email, setEmail] = useState("admin@gplabs.com.br");
  const [password, setPassword] = useState("gplabs123");
  const [rememberMe, setRememberMe] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /* =========================
     PARALLAX STATE
  ========================== */
  const [parallax, setParallax] = useState({ x: 0, y: 0 });

  function handleMouseMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;

    // converte para range -1 a 1
    const x = (relX - 0.5) * 2;
    const y = (relY - 0.5) * 2;

    setParallax({ x, y });
  }

  /* =========================
     LOGIN SUBMIT
  ========================== */
  async function handleSubmit(e) {
    e.preventDefault();
    console.log("🔐 Enviando login...", { email, password: "********" });

    if (!email || !password) {
      setError("Informe seu e-mail e senha para entrar.");
      return;
    }

    setIsSubmitting(true);
    setError("");
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.message || "Erro ao conectar ao servidor.");
      }

      if (data?.token) {
        localStorage.setItem("gpLabsAuthToken", data.token);
      }

      onLogin?.(data);
    } catch (err) {
      setError(err.message || "Não foi possível entrar. Tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  /* =========================
     RENDER
  ========================== */

  return (
    <div
      className="login-page"
      onMouseMove={handleMouseMove}
      /* variáveis para o CSS */
      style={{
        "--parallaxX": parallax.x,
        "--parallaxY": parallax.y
      }}
    >
      {/* FUNDO FUTURISTA COM PARALLAX */}
 <div className="login-background">
  <div className="login-background-layer">
    <img src="/globe-green.webp" alt="Globo futurista" />
  </div>
</div>


      {/* CARD PRINCIPAL */}
      <div className="login-card">
        {/* ================================================
            COLUNA ESQUERDA — BRANDING
        ================================================= */}
        <div className="login-brand">
          <header className="login-brand-header">
            <div className="login-logo-wrapper">
              <div className="login-logo-ring">
                <img
                  src="/gp-labs-logo.png"
                  alt="GP Labs"
                  className="login-logo-img"
                />
              </div>

              <div className="login-brand-title">
                <span className="login-brand-company">GP LABS</span>
                <span className="login-brand-product">
                  Plataforma WhatsApp
                </span>
                <span className="login-brand-tagline">
                  Central de campanhas, atendimento e chatbot.
                </span>
              </div>
            </div>
          </header>

          <main className="login-brand-main">
            <h1>Cliente On-line</h1>

            <p className="login-brand-description">
              Centralize o atendimento WhatsApp, campanhas e relatórios em um
              único painel profissional, com experiência premium de operação.
            </p>

            <ul className="login-brand-highlights">
              <li>
                <span className="login-check">✓</span> Histórico completo de conversas
              </li>
              <li>
                <span className="login-check">✓</span> Envio de campanhas, templates e mídia
              </li>
              <li>
                <span className="login-check">✓</span> Integração oficial WhatsApp Cloud API
              </li>
            </ul>

            <p className="login-brand-footnote">
              Otimizada para equipes que precisam de velocidade, segurança e
              performance em alto volume.
            </p>
          </main>

          <footer className="login-brand-footer">
            © 2025 GP Holding Participações
          </footer>
        </div>

        {/* ================================================
            COLUNA DIREITA — FORMULÁRIO
        ================================================= */}
        <div className="login-form-wrapper">
          <header className="login-form-header">
            <div className="login-env-wrapper">
              <span className="login-env-badge">Dev · Local</span>
              <span className="login-env-hint">
                Ambiente de desenvolvimento — uso interno GP Labs
              </span>
            </div>

            <h2>Entrar na plataforma</h2>

            <p className="login-form-subtitle">
              Acesse com suas credenciais de operador para continuar.
            </p>
          </header>

          {error && <div className="login-error">{error}</div>}

          <form className="login-form" onSubmit={handleSubmit}>
            {/* Campo EMAIL */}
            <div className="login-field">
              <label className="login-field-label" htmlFor="email">
                E-mail
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="seu@email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {/* Campo SENHA */}
            <div className="login-field">
              <label className="login-field-label" htmlFor="password">
                Senha
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="********"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {/* OPÇÕES INFERIORES */}
            <div className="login-options">
              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                Manter conectado
              </label>

              <button
                type="button"
                className="login-link-button"
                onClick={() => alert("Fluxo de recuperação de senha em desenvolvimento.")}
              >
                Esqueci minha senha
              </button>
            </div>

            {/* BOTÃO SUBMIT */}
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </button>

            <p className="login-security-hint">
              Suas credenciais são criptografadas em trânsito via HTTPS.
            </p>

            <p className="login-meta-info">
              Versão 1.0.4 · GP Labs – Dev App WhatsApp
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
