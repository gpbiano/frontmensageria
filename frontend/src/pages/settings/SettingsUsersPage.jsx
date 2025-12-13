import { useEffect, useMemo, useRef, useState } from "react";
import "../../styles/settings-users.css";
import {
  fetchUsers,
  createUser,
  updateUser,
  deactivateUser,
  resetUserPassword
} from "../../api";

const ROLE_LABEL = {
  admin: "Admin",
  manager: "Manager",
  agent: "Agente",
  viewer: "Visualizador"
};

const ROLE_OPTIONS = ["admin", "manager", "agent", "viewer"];

function getOrigin() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function buildInviteLink(tokenId) {
  return `${getOrigin()}/criar-senha?token=${encodeURIComponent(tokenId)}`;
}

export default function SettingsUsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [search, setSearch] = useState("");

  // modal
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState("create"); // create | edit
  const [editing, setEditing] = useState(null);

  // form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [isActive, setIsActive] = useState(true);

  // link gerado (invite/reset)
  const [lastLink, setLastLink] = useState("");

  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg || "");
    if (toastTimer.current) clearTimeout(toastTimer.current);
    if (msg) {
      toastTimer.current = setTimeout(() => setToast(""), 4000);
    }
  }

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchUsers();
      setUsers(res?.data || []);
    } catch (e) {
      setError(e?.message || "Erro ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = String(search || "").trim().toLowerCase();
    if (!q) return users;

    return (users || []).filter((u) => {
      const name = String(u?.name || "").toLowerCase();
      const email = String(u?.email || "").toLowerCase();
      const role = String(u?.role || "").toLowerCase();
      return name.includes(q) || email.includes(q) || role.includes(q);
    });
  }, [users, search]);

  function openCreate() {
    setMode("create");
    setEditing(null);
    setName("");
    setEmail("");
    setRole("agent");
    setIsActive(true);
    setLastLink("");
    setError("");
    setModalOpen(true);
  }

  function openEdit(u) {
    setMode("edit");
    setEditing(u);
    setName(u?.name || "");
    setEmail(u?.email || "");
    setRole(u?.role || "agent");
    setIsActive(u?.isActive !== false);
    setLastLink("");
    setError("");
    setModalOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError("");
    setLastLink("");

    try {
      if (!String(name || "").trim()) throw new Error("Nome é obrigatório.");

      if (mode === "create") {
        if (!String(email || "").trim()) throw new Error("E-mail é obrigatório.");
        const res = await createUser({ name: name.trim(), email: email.trim(), role });

        if (res?.token?.id) {
          setLastLink(buildInviteLink(res.token.id));
        }

        showToast("Usuário criado com sucesso.");
      } else {
        if (!editing?.id) throw new Error("Usuário inválido para edição.");
        await updateUser(editing.id, { name: name.trim(), role, isActive });
        showToast("Usuário atualizado.");
      }

      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e?.message || "Erro ao salvar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate(u) {
    if (busy) return;
    if (!window.confirm(`Desativar o usuário ${u?.name || ""}?`)) return;

    setBusy(true);
    setError("");

    try {
      await deactivateUser(u.id);
      await load();
      showToast("Usuário desativado.");
    } catch (e) {
      setError(e?.message || "Erro ao desativar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(u) {
    if (busy) return;
    if (!window.confirm(`Enviar reset de senha para ${u?.email || ""}?`)) return;

    setBusy(true);
    setError("");
    setLastLink("");

    try {
      const res = await resetUserPassword(u.id);
      if (res?.token?.id) {
        setLastLink(buildInviteLink(res.token.id));
      }
      showToast("Reset de senha enviado.");
    } catch (e) {
      setError(e?.message || "Erro ao enviar reset de senha.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(lastLink);
      showToast("Link copiado!");
    } catch (e) {
      setError("Não foi possível copiar o link. Copie manualmente.");
    }
  }

  return (
    <div className="su-page">
      <div className="su-header">
        <h2>Configurações · Usuários</h2>
        <button className="su-btn" onClick={openCreate} disabled={busy}>
          + Criar usuário
        </button>
      </div>

      <input
        className="su-input"
        placeholder="Buscar usuário…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {error && <div className="su-alert">{error}</div>}
      {toast && <div className="su-toast">{toast}</div>}

      {lastLink && (
        <div className="su-linkbox">
          <input className="su-input" value={lastLink} readOnly />
          <button className="su-btn" onClick={copyLink} disabled={!lastLink}>
            Copiar link
          </button>
        </div>
      )}

      {loading ? (
        <p>Carregando…</p>
      ) : (
        <table className="su-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>E-mail</th>
              <th>Role</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className={u.isActive === false ? "inactive" : ""}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role] || u.role}</td>
                <td>{u.isActive === false ? "Inativo" : "Ativo"}</td>
                <td>
                  <button
                    className="su-btn edit"
                    onClick={() => openEdit(u)}
                    disabled={busy}
                  >
                    Editar
                  </button>

                  <button
                    className="su-btn reset"
                    onClick={() => handleReset(u)}
                    disabled={busy}
                  >
                    Reset senha
                  </button>

                  {u.isActive !== false && (
                    <button
                      className="su-btn danger"
                      onClick={() => handleDeactivate(u)}
                      disabled={busy}
                    >
                      Desativar
                    </button>
                  )}
                </td>
              </tr>
            ))}

            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ opacity: 0.7, padding: 12 }}>
                  Nenhum usuário encontrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <div className="su-modal" onMouseDown={() => !busy && setModalOpen(false)}>
          <form onSubmit={save} onMouseDown={(e) => e.stopPropagation()}>
            <h3>{mode === "create" ? "Criar usuário" : "Editar usuário"}</h3>

            <input
              className="su-input"
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
            />

            <input
              className="su-input"
              placeholder="E-mail"
              value={email}
              disabled={mode === "edit" || busy}
              onChange={(e) => setEmail(e.target.value)}
            />

            <select
              className="su-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              disabled={busy}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r] || r}
                </option>
              ))}
            </select>

            {mode === "edit" && (
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={busy}
                />
                Usuário ativo
              </label>
            )}

            <div className="su-actions">
              <button className="su-btn" type="submit" disabled={busy}>
                {busy ? "Salvando…" : "Salvar"}
              </button>
              <button
                className="su-btn ghost"
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={busy}
              >
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
