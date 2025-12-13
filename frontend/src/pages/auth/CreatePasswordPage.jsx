// frontend/src/pages/auth/CreatePasswordPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../../styles/create-password.css";
import { verifyPasswordToken, setPasswordWithToken } from "../../api";

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search || "");
  return (params.get("token") || "").trim();
}

export default function CreatePasswordPage() {
  const token = useMemo(() => getTokenFromUrl(), []);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [valid, setValid] = useState(false);
  const [type, setType] = useState(null);
  const [user, setUser] = useState(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError("");

      if (!token) {
        if (!alive) return;
        setValid(false);
        setLoading(false);
        setError("Token ausente. Verifique o link do e-mail.");
        return;
      }

      try {
        const res = await verifyPasswordToken(token);
        if (!alive) return;

        if (res?.valid) {
          setValid(true);
          setType(res?.type || null);
          setUser(res?.user || null);
        } else {
          setValid(false);
          setError(res?.error || "Token inválido.");
        }
      } catch (e) {
        if (!alive) return;
        setValid(false);
        setError(e?.message || "Falha ao validar token. Tente novamente.");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!token) {
      setError("Token ausente. Verifique o link do e-mail.");
      return;
    }

    if (!password || password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }

    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }

    setSubmitting(true);

    try {
      await setPasswordWithToken(token, password);
      setSuccess(true);
    } catch (e) {
      setError(e?.message || "Não foi possível definir a senha.");
    } finally {
      setSubmitting(false);
    }
  }

  function goToLogin() {
    // mantém compatibilidade: se você usa hash, cai no login; se usa rota, também funciona
    window.location.href = "/#login";
  }

  return (
    <div className="create-password-page">
      <div className="cp-card">
        <div className="cp-brand">
          <div className="cp-dot" />
          <div>
            <div className="cp-title">GP Labs</div>
            <div className="cp-subtitle">Definir senha de acesso</div>
          </div>
        </div>

        {loading ? (
          <div className="cp-loading">
            <div className="cp-spinner" />
            <div>Validando token…</div>
          </div>
        ) : success ? (
          <div className="cp-success">
            <h2>Senha definida com sucesso ✅</h2>
            <p>Agora você já pode entrar na plataforma.</p>
            <button className="cp-btn" onClick={goToLogin}>
              Ir para o login
            </button>
          </div>
        ) : !valid ? (
          <div className="cp-error">
            <h2>Link inválido</h2>
            <p>{error || "Token inválido ou expirado."}</p>
            <div className="cp-help">
              Peça para o administrador gerar um novo convite/reset.
            </div>
            <button className="cp-btn cp-btn-ghost" onClick={goToLogin}>
              Voltar
            </button>
          </div>
        ) : (
          <>
            <div className="cp-greeting">
              <div className="cp-hello">
                Olá{user?.name ? `, ${user.name}` : ""} 👋
              </div>
              <div className="cp-meta">
                {user?.email ? <span>{user.email}</span> : null}
                {type ? <span className="cp-badge">{type}</span> : null}
              </div>
            </div>

            <form className="cp-form" onSubmit={handleSubmit}>
              <label className="cp-label">
                Nova senha
                <input
                  className="cp-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="mínimo 8 caracteres"
                  disabled={submitting}
                />
              </label>

              <label className="cp-label">
                Confirmar senha
                <input
                  className="cp-input"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="repita a senha"
                  disabled={submitting}
                />
              </label>

              {error ? <div className="cp-alert">{error}</div> : null}

              <button className="cp-btn" type="submit" disabled={submitting}>
                {submitting ? "Salvando…" : "Definir senha"}
              </button>

              <button
                className="cp-btn cp-btn-ghost"
                type="button"
                onClick={goToLogin}
                disabled={submitting}
              >
                Cancelar
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
