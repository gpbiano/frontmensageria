// frontend/src/pages/auth/CriarSenhaPage.jsx
import { useEffect, useMemo, useState } from "react";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

function getTokenFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get("token") || "";
}

export default function CriarSenhaPage() {
  const token = useMemo(() => getTokenFromUrl(), []);
  const [loading, setLoading] = useState(true);
  const [valid, setValid] = useState(false);
  const [info, setInfo] = useState(null);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  async function validate() {
    setLoading(true);
    setError("");
    try {
      if (!token) {
        setValid(false);
        setInfo(null);
        return;
      }

      const res = await fetch(`${API_BASE}/auth/validate-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.valid !== true) {
        setValid(false);
        setInfo(null);
        setError(data?.error || "Token inválido ou expirado.");
        return;
      }

      setValid(true);
      setInfo(data);
    } catch (e) {
      setValid(false);
      setInfo(null);
      setError(e?.message || "Falha ao validar token.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!valid) return;
    if (!password || password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }

    try {
      setSubmitting(true);

      const res = await fetch(`${API_BASE}/auth/set-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Falha ao definir senha (${res.status})`);

      setSuccess(true);
    } catch (e) {
      setError(e?.message || "Falha ao definir senha.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ maxWidth: 520, margin: "40px auto", padding: 16 }}>
      <h1 style={{ marginBottom: 6 }}>Criar senha</h1>
      <p style={{ marginTop: 0, opacity: 0.8 }}>
        Defina sua senha para acessar a Plataforma GP Labs.
      </p>

      {loading ? (
        <div className="glp-skeleton">Validando link…</div>
      ) : success ? (
        <div className="glp-alert glp-alert--ok">
          <b>Senha criada com sucesso!</b>
          <div style={{ marginTop: 8 }}>
            Você já pode fazer login no sistema.
          </div>
          <div style={{ marginTop: 12 }}>
            <a className="btn btn-primary" href="/login">
              Ir para Login
            </a>
          </div>
        </div>
      ) : !valid ? (
        <div className="glp-alert glp-alert--bad">
          <b>Link inválido</b>
          <div style={{ marginTop: 8 }}>{error || "Este link não é válido ou já expirou."}</div>
        </div>
      ) : (
        <div className="glp-surface">
          <div className="glp-alert glp-alert--info" style={{ marginBottom: 12 }}>
            <div>
              <b>Olá, {info?.user?.name || "usuário"}!</b>
            </div>
            <div style={{ marginTop: 4, opacity: 0.9 }}>
              Conta: {info?.user?.email || "-"} • Tipo: {info?.type === "reset" ? "Reset" : "Convite"}
            </div>
          </div>

          {error && <div className="glp-alert glp-alert--bad">{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: "grid", gap: 10 }}>
            <div className="glp-field">
              <div className="glp-field__label">Nova senha</div>
              <input
                className="glp-input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
              />
            </div>

            <div className="glp-field">
              <div className="glp-field__label">Confirmar senha</div>
              <input
                className="glp-input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="repita a senha"
              />
            </div>

            <button className="btn btn-primary" type="submit" disabled={submitting}>
              {submitting ? "Salvando..." : "Salvar senha"}
            </button>

            <button className="btn btn-secondary" type="button" onClick={validate} disabled={submitting}>
              Revalidar link
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
