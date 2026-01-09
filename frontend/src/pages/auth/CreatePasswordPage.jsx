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
    // mantém o teu padrão atual
    window.location.href = "/#login";
  }

  const displayName = user?.name || "bem-vindo(a)";
  const displayEmail = user?.email || "";
  const badge = type ? String(type).toUpperCase() : null;

  return (
    <div className="cp2-page">
      {/* HERO */}
      <div className="cp2-hero">
        <div className="cp2-hero-inner">
          <div className="cp2-brand">
            {/* ✅ Logo real (public/gp-labs-logo.png) */}
            <div className="cp2-logo" aria-hidden="true">
              <img
                src="/gp-labs-logo.png"
                alt="GP Labs"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
                draggable={false}
              />
            </div>

            <div className="cp2-brand-text">
              <div className="cp2-brand-title">GP Labs</div>
              <div className="cp2-brand-subtitle">
                Plataforma de WhatsApp, Automação e Atendimento
              </div>
            </div>
          </div>

          <div className="cp2-hero-copy">
            <h1>Bem-vindo(a) à GP Labs</h1>
            <p>
              Para ativar seu usuário e criar sua senha de acesso, siga os passos
              abaixo. Esse link expira em <b>24h</b>.
            </p>
          </div>
        </div>
      </div>

      {/* CONTENT */}
      <div className="cp2-wrap">
        <div className="cp2-card">
          <div className="cp2-card-head">
            <div>
              <div className="cp2-kicker">Ativação de acesso</div>
              <div className="cp2-title">Crie sua senha</div>
            </div>

            <div className="cp2-user">
              <div className="cp2-user-name">Olá, {displayName} 👋</div>
              <div className="cp2-user-meta">
                {displayEmail ? <span className="cp2-pill">{displayEmail}</span> : null}
                {badge ? <span className="cp2-pill cp2-pill-green">{badge}</span> : null}
              </div>
            </div>
          </div>

          {loading ? (
            <div className="cp2-state">
              <div className="cp2-spinner" />
              <div>
                <div className="cp2-state-title">Validando token…</div>
                <div className="cp2-state-text">
                  Só um instante — checando seu convite/reset.
                </div>
              </div>
            </div>
          ) : success ? (
            <div className="cp2-state cp2-state-success">
              <div className="cp2-state-icon">✅</div>
              <div>
                <div className="cp2-state-title">Senha definida com sucesso</div>
                <div className="cp2-state-text">
                  Agora você já pode entrar na plataforma com seu e-mail e senha.
                </div>
                <div className="cp2-actions">
                  <button className="cp2-btn" onClick={goToLogin}>
                    Ir para o login
                  </button>
                </div>
              </div>
            </div>
          ) : !valid ? (
            <div className="cp2-state cp2-state-error">
              <div className="cp2-state-icon">⚠️</div>
              <div>
                <div className="cp2-state-title">Link inválido</div>
                <div className="cp2-state-text">
                  {error || "Token inválido ou expirado."}
                </div>
                <div className="cp2-help">
                  Peça para o administrador gerar um novo convite/reset.
                </div>
                <div className="cp2-actions">
                  <button className="cp2-btn cp2-btn-ghost" onClick={goToLogin}>
                    Voltar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="cp2-instructions">
                <div className="cp2-info">
                  <div className="cp2-info-title">Ative seu acesso</div>
                  <div className="cp2-info-text">
                    Defina uma senha forte para acessar a plataforma e começar a operar
                    atendimento, campanhas e automações.
                  </div>
                </div>
              </div>

              <form className="cp2-form" onSubmit={handleSubmit}>
                <label className="cp2-label">
                  Nova senha
                  <input
                    className="cp2-input"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="mínimo 8 caracteres"
                    disabled={submitting}
                  />
                </label>

                <label className="cp2-label">
                  Confirmar senha
                  <input
                    className="cp2-input"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="repita a senha"
                    disabled={submitting}
                  />
                </label>

                {error ? <div className="cp2-alert">{error}</div> : null}

                <div className="cp2-actions">
                  <button className="cp2-btn" type="submit" disabled={submitting}>
                    {submitting ? "Salvando…" : "Criar senha"}
                  </button>

                  <button
                    className="cp2-btn cp2-btn-ghost"
                    type="button"
                    onClick={goToLogin}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                </div>

                <div className="cp2-mini">Ao continuar, você concorda com nossas políticas.</div>

                <div className="cp2-policy-row">
                  <button type="button" className="cp2-linkbtn">
                    Política de Privacidade
                  </button>
                  <button type="button" className="cp2-linkbtn">
                    Termos de Uso
                  </button>
                  <button type="button" className="cp2-linkbtn">
                    Segurança
                  </button>
                </div>
              </form>
            </>
          )}
        </div>

        {/* FOOTER */}
        <footer className="cp2-footer">
          <div className="cp2-footer-top">
            <div className="cp2-footer-brand">
              {/* ✅ logo no footer */}
              <div className="cp2-footer-logo" aria-hidden="true">
                <img
                  src="/gp-labs-logo.png"
                  alt="GP Labs"
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                  draggable={false}
                />
              </div>

              <div>
                <div className="cp2-footer-title">GP Labs</div>
                <div className="cp2-footer-sub">
                  Marketing • Tecnologia • Automação • WhatsApp
                </div>
              </div>
            </div>

            <div className="cp2-social">
              <button type="button" className="cp2-social-btn">LinkedIn</button>
              <button type="button" className="cp2-social-btn">Instagram</button>
              <button type="button" className="cp2-social-btn">YouTube</button>
              <button type="button" className="cp2-social-btn">Site</button>
            </div>
          </div>

          <div className="cp2-footer-bottom">
            <div className="cp2-footer-note">
              Você recebeu este e-mail porque um administrador criou uma conta para você na GP Labs.
            </div>

            <button type="button" className="cp2-unsub">
              Cancelar recebimento de e-mails
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
