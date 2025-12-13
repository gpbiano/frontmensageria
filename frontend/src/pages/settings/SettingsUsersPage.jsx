import { useEffect, useMemo, useState } from "react";
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
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
    );
  }, [users, search]);

  function openCreate() {
    setMode("create");
    setEditing(null);
    setName("");
    setEmail("");
    setRole("agent");
    setIsActive(true);
    setLastLink("");
    setModalOpen(true);
  }

  function openEdit(u) {
    setMode("edit");
    setEditing(u);
    setName(u.name);
    setEmail(u.email);
    setRole(u.role);
    setIsActive(u.isActive !== false);
    setLastLink("");
    setModalOpen(true);
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setToast("");
    setLastLink("");

    try {
      if (!name.trim()) throw new Error("Nome é obrigatório.");

      if (mode === "create") {
        if (!email.trim()) throw new Error("E-mail é obrigatório.");
        const res = await createUser({ name, email, role });
        if (res?.token?.id) {
          setLastLink(buildInviteLink(res.token.id));
        }
        setToast("Usuário criado com sucesso.");
      } else {
        await updateUser(editing.id, { name, role, isActive });
        setToast("Usuário atualizado.");
      }

      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e.message || "Erro ao salvar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeactivate(u) {
    if (!confirm(`Desativar o usuário ${u.name}?`)) return;
    setBusy(true);
    try {
      await deactivateUser(u.id);
      await load();
      setToast("Usuário desativado.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(u) {
    if (!confirm(`Enviar reset de senha para ${u.email}?`)) return;
    setBusy(true);
    try {
      const res = await resetUserPassword(u.id);
      if (res?.token?.id) {
        setLastLink(buildInviteLink(res.token.id));
      }
      setToast("Reset de senha enviado.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="su-page">
      <div className="su-header">
        <h2>Configurações · Usuários</h2>
        <button className="su-btn" onClick={openCreate}>
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
          <button
            className="su-btn"
            onClick={() => navigator.clipboard.writeText(lastLink)}
          >
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
              <tr key={u.id} className={!u.isActive ? "inactive" : ""}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{ROLE_LABEL[u.role]}</td>
                <td>{u.isActive ? "Ativo" : "Inativo"}</td>
                <td>
                  <button onClick={() => openEdit(u)}>Editar</button>
                  <button onClick={() => handleReset(u)}>Reset senha</button>
                  {u.isActive && (
                    <button onClick={() => handleDeactivate(u)}>
                      Desativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <div className="su-modal">
          <form onSubmit={save}>
            <h3>{mode === "create" ? "Criar usuário" : "Editar usuário"}</h3>

            <input
              className="su-input"
              placeholder="Nome"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <input
              className="su-input"
              placeholder="E-mail"
              value={email}
              disabled={mode === "edit"}
              onChange={(e) => setEmail(e.target.value)}
            />

            <select
              className="su-input"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>

            {mode === "edit" && (
              <label>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />{" "}
                Usuário ativo
              </label>
            )}

            <div className="su-actions">
              <button className="su-btn" type="submit">
                Salvar
              </button>
              <button
                className="su-btn ghost"
                type="button"
                onClick={() => setModalOpen(false)}
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
