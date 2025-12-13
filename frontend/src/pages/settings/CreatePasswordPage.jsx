// frontend/src/pages/settings/CreatePasswordPage.jsx
import { useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || "";
}

export default function CreatePasswordPage() {
  const token = useMemo(() => getTokenFromUrl(), []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState("");

  const disabled = !token || !password || password.length < 6 || password !== confirm || loading;

  async function submit(e) {
    e.preventDefault();
    setError("");

    if (!token) return setError("Token ausente na URL.");
    if (password.length < 6) return setError("A senha deve ter no mínimo 6 caracteres.");
    if (password !== confirm) return setError("As senhas não conferem.");

    try {
      setLoading(true);
      const res = await fetch(`${API_BASE}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Falha ao definir senha (${res.status})`);

      setOk(true);
    } catch (err) {
      setError(err?.message || "Falha ao definir senha.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1>Criar senha</h1>
        <p className="page-subtitle">Defina sua senha para acessar a Plataforma GP Labs.</p>
      </div>

      {error && <div className="glp-alert glp-alert--bad">{error}</div>}

      <div className="glp-surface" style={{ maxWidth: 520 }}>
        {ok ? (
          <div className="glp-alert glp-alert--good">
            Senha definida com sucesso ✅<br />
            Agora você já pode entrar na plataforma.
            <div style={{ marginTop: 12 }}>
              <a className="btn btn-primary" href="/login">
                Ir para o login
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="glp-field">
              <div className="glp-field__label">Nova senha</div>
              <input
                className="glp-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                autoFocus
              />
            </div>

            <div className="glp-field" style={{ marginTop: 12 }}>
              <div className="glp-field__label">Confirmar senha</div>
              <input
                className="glp-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Digite novamente"
              />
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 10 }}>
              <button className="btn btn-primary" type="submit" disabled={disabled}>
                {loading ? "Salvando..." : "Definir senha"}
              </button>
              <a className="btn btn-secondary" href="/login">
                Voltar
              </a>
            </div>

            {!token ? (
              <div className="glp-alert glp-alert--info" style={{ marginTop: 14 }}>
                Token não encontrado na URL. Abra o link do e-mail novamente.
              </div>
            ) : null}
          </form>
        )}
      </div>
    </div>
  );
}
