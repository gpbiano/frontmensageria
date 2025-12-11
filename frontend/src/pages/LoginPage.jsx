// frontend/src/pages/LoginPage.jsx
import { useState } from "react";
import "../styles/LoginPage.css";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3010";

export default function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("admin@gplabs.com.br");
  const [password, setPassword] = useState("gplabs123");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        headers: {
          "Content-Type": "application/json"
        },
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
        localStorage.setItem("gpLabsAuthToken", data.token);
      }

      onLogin?.(data);
    } catch (err) {
      console.error("Erro ao logar:", err);

      // Fallback em modo DEV – te coloca pra dentro mesmo sem backend
      if (import.meta.env.DEV) {
        console.warn(
          "[DEV] Backend falhou, usando login de desenvolvimento sem validar no servidor."
        );
        const fakeData = {
          token: "dev-fallback-token",
          user: {
            email,
            name: "Admin (Dev)"
          }
        };
        localStorage.setItem("gpLabsAuthToken", fakeData.token);
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
        <h1 className="login-title">Entrar na plataforma</h1>
        <p className="login-subtitle">
          Acesse com suas credenciais de operador.
        </p>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label">
            E-mail
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="login-label">
            Senha
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <div className="login-row">
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
              className="login-link"
              onClick={() =>
                alert("Fluxo de recuperação ainda não implementado.")
              }
            >
              Esqueci minha senha
            </button>
          </div>

          <button
            type="submit"
            className="login-submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Entrando..." : "Entrar"}
          </button>
        </form>

        <p className="login-env">
          Ambiente: <strong>{import.meta.env.MODE}</strong> · API:{" "}
          <code>{API_BASE}</code>
        </p>
      </div>
    </div>
  );
}
