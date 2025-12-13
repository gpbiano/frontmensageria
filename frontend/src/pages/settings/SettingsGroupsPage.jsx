// frontend/src/pages/settings/SettingsGroupsPage.jsx
import { useEffect, useMemo, useState } from "react";
import {
  fetchGroups,
  createGroup,
  updateGroup,
  deactivateGroup,
  activateGroup,

  // ✅ users + group members
  fetchUsers,
  fetchGroupMembers,
  addGroupMember,
  updateGroupMember,
  deactivateGroupMember,
  activateGroupMember
} from "../../api";
import "../../styles/settings-groups.css";

export default function SettingsGroupsPage() {
  const [items, setItems] = useState([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // create form
  const [name, setName] = useState("");
  const [color, setColor] = useState("#22c55e");
  const [slaMinutes, setSlaMinutes] = useState(10);

  // edit modal/state
  const [editing, setEditing] = useState(null); // group
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#22c55e");
  const [editSlaMinutes, setEditSlaMinutes] = useState(10);

  // ✅ members state
  const [users, setUsers] = useState([]); // all users
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersErr, setMembersErr] = useState("");
  const [members, setMembers] = useState([]);
  const [membersIncludeInactive, setMembersIncludeInactive] = useState(false);

  // add member form
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedMemberRole, setSelectedMemberRole] = useState("agent");

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const res = await fetchGroups({ includeInactive });
      setItems(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setErr(e?.message || "Falha ao carregar grupos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeInactive]);

  const activeCount = useMemo(
    () => (items || []).filter((g) => g?.isActive !== false).length,
    [items]
  );

  async function onCreate(e) {
    e.preventDefault();
    setErr("");

    const n = String(name || "").trim();
    if (!n) {
      setErr("Informe o nome do grupo.");
      return;
    }

    try {
      await createGroup({
        name: n,
        color,
        slaMinutes: Number(slaMinutes || 10)
      });

      setName("");
      setColor("#22c55e");
      setSlaMinutes(10);
      await load();
    } catch (e2) {
      setErr(e2?.message || "Falha ao criar grupo.");
    }
  }

  async function loadUsersOnce() {
    // carrega usuários só quando abrir modal (e se ainda não carregou)
    if (users && users.length > 0) return;
    try {
      const res = await fetchUsers();
      setUsers(Array.isArray(res?.data) ? res.data : []);
    } catch (e) {
      // não trava a tela; só informa no bloco de membros
      setMembersErr(e?.message || "Falha ao carregar usuários.");
    }
  }

  async function loadMembers(groupId) {
    if (!groupId) return;
    setMembersLoading(true);
    setMembersErr("");
    try {
      const res = await fetchGroupMembers(groupId, {
        includeInactive: membersIncludeInactive
      });
      setMembers(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      setMembersErr(e?.message || "Falha ao carregar membros do grupo.");
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }

  function openEdit(g) {
    setErr("");
    setMembersErr("");
    setEditing(g);
    setEditName(g?.name || "");
    setEditColor(g?.color || "#22c55e");
    setEditSlaMinutes(Number(g?.slaMinutes ?? 10));

    // reset membros form
    setSelectedUserId("");
    setSelectedMemberRole("agent");
    setMembersIncludeInactive(false);
    setMembers([]);

    // carrega users + membros
    loadUsersOnce();
    loadMembers(g?.id);
  }

  function closeEdit() {
    setEditing(null);
    setMembers([]);
    setMembersErr("");
  }

  // recarrega membros quando toggle includeInactive mudar dentro do modal
  useEffect(() => {
    if (editing?.id) loadMembers(editing.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [membersIncludeInactive, editing?.id]);

  async function onSaveEdit(e) {
    e.preventDefault();
    if (!editing?.id) return;

    const n = String(editName || "").trim();
    if (!n) {
      setErr("Nome inválido.");
      return;
    }

    setErr("");
    try {
      await updateGroup(editing.id, {
        name: n,
        color: editColor,
        slaMinutes: Number(editSlaMinutes || 10)
      });
      closeEdit();
      await load();
    } catch (e2) {
      setErr(e2?.message || "Falha ao salvar grupo.");
    }
  }

  async function onDeactivate(id) {
    if (!id) return;
    setErr("");
    try {
      await deactivateGroup(id);
      await load();
    } catch (e) {
      setErr(e?.message || "Falha ao desativar grupo.");
    }
  }

  async function onActivate(id) {
    if (!id) return;
    setErr("");
    try {
      await activateGroup(id);
      await load();
    } catch (e) {
      setErr(
        e?.message ||
          "Falha ao ativar grupo. (Se der 404, faltou rota /activate no backend)"
      );
    }
  }

  // ============================
  // ✅ MEMBERS ACTIONS
  // ============================

  const activeMembersCount = useMemo(
    () => (members || []).filter((m) => m?.isActive !== false).length,
    [members]
  );

  const usersById = useMemo(() => {
    const map = new Map();
    (users || []).forEach((u) => map.set(String(u.id), u));
    return map;
  }, [users]);

  const userOptions = useMemo(() => {
    // mostra apenas usuários ativos e que ainda não estão ativos no grupo
    const activeMemberUserIds = new Set(
      (members || [])
        .filter((m) => m?.isActive !== false)
        .map((m) => String(m.userId))
    );

    const list = (users || [])
      .filter((u) => u?.isActive !== false)
      .filter((u) => !activeMemberUserIds.has(String(u.id)));

    // ordena pelo nome
    list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    return list;
  }, [users, members]);

  async function onAddMember(e) {
    e.preventDefault();
    setMembersErr("");

    if (!editing?.id) return;

    const uid = String(selectedUserId || "").trim();
    if (!uid) {
      setMembersErr("Selecione um usuário para adicionar ao grupo.");
      return;
    }

    try {
      await addGroupMember(editing.id, {
        userId: Number(uid),
        role: selectedMemberRole
      });

      setSelectedUserId("");
      setSelectedMemberRole("agent");
      await loadMembers(editing.id);
    } catch (e) {
      setMembersErr(e?.message || "Falha ao adicionar membro.");
    }
  }

  async function onChangeMemberRole(userId, role) {
    if (!editing?.id) return;
    setMembersErr("");
    try {
      await updateGroupMember(editing.id, Number(userId), { role });
      await loadMembers(editing.id);
    } catch (e) {
      setMembersErr(e?.message || "Falha ao atualizar papel do membro.");
    }
  }

  async function onDeactivateMember(userId) {
    if (!editing?.id) return;
    setMembersErr("");
    try {
      await deactivateGroupMember(editing.id, Number(userId));
      await loadMembers(editing.id);
    } catch (e) {
      setMembersErr(e?.message || "Falha ao remover membro (desativar).");
    }
  }

  async function onActivateMember(userId) {
    if (!editing?.id) return;
    setMembersErr("");
    try {
      await activateGroupMember(editing.id, Number(userId));
      await loadMembers(editing.id);
    } catch (e) {
      setMembersErr(e?.message || "Falha ao reativar membro.");
    }
  }

  return (
    <div className="settings-groups-page">
      <div className="settings-groups-header">
        <div>
          <h2>Grupos de Atendimento</h2>
          <p className="settings-groups-subtitle">
            Organize filas e times (ex: Vendas, Suporte, Financeiro).{" "}
            <span className="settings-groups-kpi">
              Ativos: <b>{activeCount}</b> · Total: <b>{items?.length || 0}</b>
            </span>
          </p>
        </div>

        <label className="settings-groups-toggle">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          <span>Mostrar inativos</span>
        </label>
      </div>

      {err && <div className="settings-groups-error">{err}</div>}

      {/* CREATE */}
      <div className="settings-groups-card">
        <h3>Criar novo grupo</h3>

        <form className="settings-groups-form" onSubmit={onCreate}>
          <div className="field">
            <label>Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Suporte"
            />
          </div>

          <div className="field">
            <label>Cor</label>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Cor do grupo"
            />
          </div>

          <div className="field">
            <label>SLA (min)</label>
            <input
              type="number"
              min={1}
              value={slaMinutes}
              onChange={(e) => setSlaMinutes(Number(e.target.value))}
            />
          </div>

          <button className="btn-primary" type="submit" disabled={loading}>
            {loading ? "Salvando..." : "Criar grupo"}
          </button>
        </form>
      </div>

      {/* LIST */}
      <div className="settings-groups-card">
        <div className="settings-groups-list-header">
          <h3>Grupos</h3>
          <button className="btn-ghost" onClick={load} disabled={loading}>
            Atualizar
          </button>
        </div>

        {loading && <div className="settings-groups-empty">Carregando...</div>}

        {!loading && (!items || items.length === 0) && (
          <div className="settings-groups-empty">
            Nenhum grupo cadastrado ainda.
          </div>
        )}

        <div className="settings-groups-grid">
          {(items || []).map((g) => {
            const inactive = g?.isActive === false;

            return (
              <div
                key={g.id}
                className={`group-item ${inactive ? "inactive" : ""}`}
              >
                <div className="group-item-top">
                  <div
                    className="group-badge"
                    style={{ background: g?.color || "#22c55e" }}
                    title={g?.color || "#22c55e"}
                  />
                  <div className="group-meta">
                    <div className="group-name">
                      {g?.name || "Sem nome"}
                      {inactive && (
                        <span className="group-inactive-pill">Inativo</span>
                      )}
                    </div>
                    <div className="group-sub">
                      SLA: {Number(g?.slaMinutes ?? 10)} min
                    </div>
                  </div>
                </div>

                <div className="group-actions">
                  <button className="btn-secondary" onClick={() => openEdit(g)}>
                    Editar / Membros
                  </button>

                  {!inactive ? (
                    <button
                      className="btn-danger"
                      onClick={() => onDeactivate(g.id)}
                    >
                      Desativar
                    </button>
                  ) : (
                    <button
                      className="btn-primary"
                      onClick={() => onActivate(g.id)}
                    >
                      Ativar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* EDIT MODAL */}
      {editing && (
        <div className="settings-groups-modal-overlay" onMouseDown={closeEdit}>
          <div
            className="settings-groups-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h3>Editar grupo</h3>
              <button className="btn-ghost" onClick={closeEdit}>
                ✕
              </button>
            </div>

            {/* FORM DO GRUPO */}
            <form className="settings-groups-form" onSubmit={onSaveEdit}>
              <div className="field">
                <label>Nome</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              <div className="field">
                <label>Cor</label>
                <input
                  type="color"
                  value={editColor}
                  onChange={(e) => setEditColor(e.target.value)}
                />
              </div>

              <div className="field">
                <label>SLA (min)</label>
                <input
                  type="number"
                  min={1}
                  value={editSlaMinutes}
                  onChange={(e) => setEditSlaMinutes(Number(e.target.value))}
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={closeEdit}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Salvar
                </button>
              </div>

              <div className="modal-footnote">
                Dica: se o botão “Ativar” der 404, falta criar a rota{" "}
                <code>/settings/groups/:id/activate</code> no backend.
              </div>
            </form>

            {/* ✅ MEMBERS */}
            <div style={{ marginTop: 18 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12
                }}
              >
                <h3 style={{ margin: 0 }}>
                  Membros do grupo{" "}
                  <span style={{ opacity: 0.75, fontSize: 12 }}>
                    (Ativos: <b>{activeMembersCount}</b> · Total:{" "}
                    <b>{members?.length || 0}</b>)
                  </span>
                </h3>

                <label className="settings-groups-toggle">
                  <input
                    type="checkbox"
                    checked={membersIncludeInactive}
                    onChange={(e) => setMembersIncludeInactive(e.target.checked)}
                  />
                  <span>Mostrar inativos</span>
                </label>
              </div>

              {membersErr && (
                <div className="settings-groups-error" style={{ marginTop: 10 }}>
                  {membersErr}
                </div>
              )}

              {/* ADD MEMBER */}
              <div className="settings-groups-card" style={{ marginTop: 12 }}>
                <h3>Adicionar membro</h3>

                <form className="settings-groups-form" onSubmit={onAddMember}>
                  <div className="field">
                    <label>Usuário</label>
                    <select
                      value={selectedUserId}
                      onChange={(e) => setSelectedUserId(e.target.value)}
                    >
                      <option value="">Selecione...</option>
                      {(userOptions || []).map((u) => (
                        <option key={u.id} value={String(u.id)}>
                          {u.name} ({u.email}) — {u.role}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label>Papel no grupo</label>
                    <select
                      value={selectedMemberRole}
                      onChange={(e) => setSelectedMemberRole(e.target.value)}
                    >
                      <option value="agent">Agent</option>
                      <option value="manager">Manager</option>
                    </select>
                  </div>

                  <button
                    className="btn-primary"
                    type="submit"
                    disabled={membersLoading}
                    title={
                      userOptions.length === 0
                        ? "Nenhum usuário disponível (ou todos já estão no grupo)"
                        : "Adicionar"
                    }
                  >
                    {membersLoading ? "Salvando..." : "Adicionar"}
                  </button>
                </form>

                {users?.length === 0 && (
                  <div className="settings-groups-empty" style={{ marginTop: 10 }}>
                    Nenhum usuário carregado ainda (verifique permissões/rota
                    /settings/users).
                  </div>
                )}
              </div>

              {/* MEMBERS LIST */}
              <div className="settings-groups-card" style={{ marginTop: 12 }}>
                <div className="settings-groups-list-header">
                  <h3>Membros</h3>
                  <button
                    className="btn-ghost"
                    onClick={() => loadMembers(editing?.id)}
                    disabled={membersLoading}
                    type="button"
                  >
                    Atualizar
                  </button>
                </div>

                {membersLoading && (
                  <div className="settings-groups-empty">Carregando membros...</div>
                )}

                {!membersLoading && (!members || members.length === 0) && (
                  <div className="settings-groups-empty">
                    Nenhum membro encontrado para este grupo.
                  </div>
                )}

                {!membersLoading && members?.length > 0 && (
                  <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                    {members.map((m) => {
                      const inactive = m?.isActive === false;
                      const u = usersById.get(String(m.userId));

                      const displayName =
                        m?.name || u?.name || "Usuário removido";
                      const displayEmail = m?.email || u?.email || "";
                      const memberRole = String(m?.memberRole || "agent");

                      return (
                        <div
                          key={`${m.groupId}-${m.userId}`}
                          className={`group-item ${inactive ? "inactive" : ""}`}
                          style={{
                            padding: 12,
                            borderRadius: 12
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 12
                            }}
                          >
                            <div>
                              <div className="group-name" style={{ marginBottom: 4 }}>
                                {displayName}{" "}
                                {inactive && (
                                  <span className="group-inactive-pill">
                                    Inativo
                                  </span>
                                )}
                              </div>
                              <div className="group-sub" style={{ opacity: 0.9 }}>
                                {displayEmail ? (
                                  <>
                                    {displayEmail} ·{" "}
                                    <span style={{ opacity: 0.85 }}>
                                      userRole: {m?.userRole || u?.role || "agent"}
                                    </span>
                                  </>
                                ) : (
                                  <span style={{ opacity: 0.85 }}>
                                    userId: {m.userId}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div
                              className="group-actions"
                              style={{ alignItems: "center" }}
                            >
                              <select
                                value={memberRole}
                                onChange={(e) =>
                                  onChangeMemberRole(m.userId, e.target.value)
                                }
                                disabled={inactive}
                                title={
                                  inactive
                                    ? "Reative o membro para editar o papel"
                                    : "Papel do membro"
                                }
                              >
                                <option value="agent">agent</option>
                                <option value="manager">manager</option>
                              </select>

                              {!inactive ? (
                                <button
                                  className="btn-danger"
                                  type="button"
                                  onClick={() => onDeactivateMember(m.userId)}
                                >
                                  Remover
                                </button>
                              ) : (
                                <button
                                  className="btn-primary"
                                  type="button"
                                  onClick={() => onActivateMember(m.userId)}
                                >
                                  Reativar
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="modal-footnote" style={{ marginTop: 12 }}>
                  Rotas esperadas:{" "}
                  <code>/settings/groups/:id/members</code>,{" "}
                  <code>/settings/groups/:id/members/:userId</code>,{" "}
                  <code>/settings/groups/:id/members/:userId/deactivate</code>,{" "}
                  <code>/settings/groups/:id/members/:userId/activate</code>
                </div>
              </div>
            </div>

            {/* footer geral */}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn-secondary" type="button" onClick={closeEdit}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
