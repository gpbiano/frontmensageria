// frontend/src/pages/LoginPage.jsx
import { useEffect, useMemo, useState } from "react";
import "../styles/login-page.css";

const API_BASE =
  import.meta.env.VITE_API_BASE ||
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3010";

const AUTH_TOKEN_KEY = "gpLabsAuthToken";
const AUTH_USER_KEY = "gpLabsAuthUser";

// ✅ URLs (ajuste quando tiver as páginas reais)
const TERMS_URL = "/termos";
const PRIVACY_URL = "/privacidade";

async function fetchJson(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();

  // ✅ Merge de headers (SEM risco de sobrescrever Content-Type)
  const baseHeaders = {
    "Content-Type": "application/json"
  };

  const mergedHeaders = {
    ...baseHeaders,
    ...(options.headers || {})
  };

  const fetchOptions = {
    ...options,
    method,
    headers: mergedHeaders,

    // ✅ Ajuda muito em PROD com Cloudflare/CORS
    mode: "cors",
    credentials: "include",
    cache: "no-store"
  };

  const res = await fetch(url, fetchOptions);

  const contentType = res.headers.get("content-type") || "";
  const rawText = await res.text().catch(() => "");

  // ✅ Se a API não retornar JSON, mostra preview pra debugar
  if (!contentType.includes("application/json")) {
    throw new Error(
      `Resposta inválida da API (${res.status}): ${rawText?.slice?.(0, 200) || ""}`
    );
  }

  let data = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    data = {};
  }

  if (!res.ok) throw new Error(data?.error || data?.message || "Erro na API.");
  return data;
}

function safeSet(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (e) {
    console.error("[AUTH] storage.setItem falhou", { key, err: String(e?.message || e) });
    return false;
  }
}

function safeGet(storage, key) {
  try {
    return storage.getItem(key);
  } catch (e) {
    console.error("[AUTH] storage.getItem falhou", { key, err: String(e?.message || e) });
    return null;
  }
}

function safeRemove(storage, key) {
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function maskToken(t) {
  const s = String(t || "");
  if (!s) return "(empty)";
  return `${s.slice(0, 14)}...${s.slice(-8)} (len=${s.length})`;
}

export default function LoginPage({ onLogin }) {
  const isDev = import.meta.env.DEV;

  // ✅ Em DEV facilita testes | em PROD nunca preenche
  const [email, setEmail] = useState(isDev ? "admin@gplabs.com.br" : "");
  const [password, setPassword] = useState(isDev ? "gplabs123" : "");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ Em PROD garante que senha nunca “vaze”
  useEffect(() => {
    if (!isDev) setPassword("");
  }, [isDev]);

  const canSubmit = useMemo(
    () => Boolean(email && password && !isSubmitting),
    [email, password, isSubmitting]
  );

  function persistSession({ token, user }) {
    if (typeof window === "undefined") return;

    const t = String(token || "").trim();
    if (!t) throw new Error("Token vazio no login.");

    // ✅ limpa sempre (evita mismatch)
    safeRemove(localStorage, AUTH_TOKEN_KEY);
    safeRemove(localStorage, AUTH_USER_KEY);
    safeRemove(sessionStorage, AUTH_TOKEN_KEY);
    safeRemove(sessionStorage, AUTH_USER_KEY);

    // ✅ token SEMPRE nos DOIS storages (padrão do projeto)
    const okLocalToken = safeSet(localStorage, AUTH_TOKEN_KEY, t);
    const okSessionToken = safeSet(sessionStorage, AUTH_TOKEN_KEY, t);

    // user segue a regra do rememberMe
    const storageForUser = rememberMe ? localStorage : sessionStorage;
    const okUser = safeSet(storageForUser, AUTH_USER_KEY, JSON.stringify(user || null));

    // ✅ sanity check real (evita “não aparece no local storage”)
    const savedLocal = safeGet(localStorage, AUTH_TOKEN_KEY);
    const savedSession = safeGet(sessionStorage, AUTH_TOKEN_KEY);
    const saved = savedLocal || savedSession;

    if (!saved || saved !== t) {
      console.error("[AUTH] Token não persistiu", {
        okLocalToken,
        okSessionToken,
        savedLocal: maskToken(savedLocal),
        savedSession: maskToken(savedSession)
      });

      throw new Error(
        "Login OK, mas o navegador não persistiu o token (storage bloqueado, modo privado, extensão, ou política do browser)."
      );
    }

    if (!okLocalToken && !okSessionToken) {
      throw new Error("Não foi possível salvar o token em nenhum storage.");
    }
    if (!okUser) {
      console.warn("[AUTH] Não consegui persistir o usuário no storage.");
    }

    // ✅ evento pra mesma aba (App pode ouvir se quiser)
    window.dispatchEvent(new Event("gp-auth-changed"));

    // debug opcional (não interfere)
    window.__GP_AUTH_TOKEN__ = t;

    console.log("[AUTH] sessão persistida", {
      token: maskToken(t),
      okLocalToken,
      okSessionToken,
      okUser,
      rememberMe
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();

    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPassword = String(password || "").trim();

    if (!cleanEmail || !cleanPassword) {
      setError("Informe seu e-mail e senha para entrar.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const data = await fetchJson(`${API_BASE}/login`, {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
      });

      if (!data?.token || !data?.user) {
        console.error("[AUTH] resposta /login inválida", data);
        throw new Error("Resposta inválida da API de login.");
      }

      console.log("[AUTH] /login OK", {
        userEmail: data?.user?.email,
        token: maskToken(data?.token)
      });

      persistSession({ token: data.token, user: data.user });

      setPassword("");
      onLogin?.({ token: data.token, user: data.user });
    } catch (err) {
      console.error("Erro ao logar:", err);

      // ⚠️ Fallback APENAS em DEV
      if (isDev) {
        console.warn("[DEV] Usando login de fallback.");
        const fakeData = {
          token: "dev-fallback-token",
          user: { id: 0, name: "Admin (Dev)", email: cleanEmail }
        };
        try {
          persistSession(fakeData);
          onLogin?.(fakeData);
        } catch (e2) {
          setError(e2?.message || "Falha ao salvar sessão (DEV).");
        }
      } else {
        setError(
          err.message?.includes("Failed to fetch")
            ? "Não foi possível conectar ao servidor."
            : err.message || "Não foi possível entrar."
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

        <div className="login-subtitle">Acesse com suas credenciais de operador.</div>

        {error && <div className="login-error">{error}</div>}

        <form className="login-form" onSubmit={handleSubmit} autoComplete="on">
          <label className="login-label">
            E-mail
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
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
              onClick={() => alert("Fluxo de recuperação de senha ainda não implementado.")}
            >
              Esqueci minha senha
            </button>
          </div>

          <button type="submit" className="login-submit" disabled={!canSubmit}>
            {isSubmitting ? (
              <span className="btn-loading">
                <span className="btn-spinner" />
                Entrando...
              </span>
            ) : (
              "Entrar"
            )}
          </button>

          {/* ✅ Termos/Privacidade (estilo “Aegro”) */}
          <p className="login-legal">
            Ao acessar, você concorda com os{" "}
            <a href={TERMS_URL} target="_blank" rel="noreferrer">
              Termos de Uso
            </a>{" "}
            e a{" "}
            <a href={PRIVACY_URL} target="_blank" rel="noreferrer">
              Política de Privacidade
            </a>
            .
          </p>
        </form>
      </div>
    </div>
  );
}
