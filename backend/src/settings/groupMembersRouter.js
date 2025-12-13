// backend/src/settings/groupMembersStorage.js
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "gm") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeRole(role) {
  const v = String(role || "").trim().toLowerCase();
  if (v === "manager") return "manager";
  return "agent";
}

function normalizeGroupId(groupId) {
  const v = String(groupId || "").trim();
  return v ? v : null;
}

function normalizeUserId(userId) {
  if (userId === undefined || userId === null) return null;
  const n = Number(userId);
  if (!Number.isFinite(n)) return null;
  return n;
}

function findGroup(db, groupId) {
  db.groups = ensureArray(db.groups);
  return db.groups.find((g) => String(g.id) === String(groupId)) || null;
}

function findUser(db, userId) {
  db.users = ensureArray(db.users);
  return db.users.find((u) => String(u.id) === String(userId)) || null;
}

function findMember(db, groupId, userId) {
  db.groupMembers = ensureArray(db.groupMembers);
  return (
    db.groupMembers.find(
      (m) =>
        String(m.groupId) === String(groupId) &&
        String(m.userId) === String(userId)
    ) || null
  );
}

function toMemberView(db, member) {
  const u = findUser(db, member.userId);
  return {
    id: member.id,
    groupId: member.groupId,
    userId: member.userId,
    memberRole: member.role || "agent",
    isActive: member.isActive !== false,
    createdAt: member.createdAt,
    updatedAt: member.updatedAt,

    // snapshot do user (pra UI)
    name: u?.name || "Usuário removido",
    email: u?.email || "",
    userRole: u?.role || "agent",
    userIsActive: u?.isActive !== false
  };
}

/**
 * Lista membros do grupo (com join no user)
 */
export function listMembers(groupId, { includeInactive = false } = {}) {
  const db = loadDB();
  const gid = normalizeGroupId(groupId);
  if (!gid) {
    return { error: "groupId inválido (param ausente)." };
  }

  const group = findGroup(db, gid);
  if (!group) {
    return { error: "Grupo não encontrado.", status: 404 };
  }

  db.groupMembers = ensureArray(db.groupMembers);

  const items = db.groupMembers
    .filter((m) => String(m.groupId) === String(gid))
    .filter((m) => (includeInactive ? true : m.isActive !== false))
    .map((m) => toMemberView(db, m));

  return { group, items, total: items.length };
}

/**
 * Adiciona (ou reativa) membro
 */
export function addMember(groupId, userId, { role = "agent" } = {}) {
  const db = loadDB();
  const gid = normalizeGroupId(groupId);
  const uid = normalizeUserId(userId);

  if (!gid) return { error: "groupId inválido (param ausente)." };
  if (!uid && uid !== 0) return { error: "userId é obrigatório." };

  const group = findGroup(db, gid);
  if (!group) return { error: "Grupo não encontrado.", status: 404 };

  const user = findUser(db, uid);
  if (!user) return { error: "Usuário não encontrado.", status: 404 };

  db.groupMembers = ensureArray(db.groupMembers);

  const ts = nowIso();
  const normalizedRole = normalizeRole(role);

  const existing = findMember(db, gid, uid);
  if (existing) {
    existing.role = normalizedRole;
    existing.isActive = true;
    existing.updatedAt = ts;
    saveDB(db);

    return {
      success: true,
      created: false,
      member: existing,
      memberView: toMemberView(db, existing),
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      group
    };
  }

  const member = {
    id: newId("gm"),
    groupId: String(gid),
    userId: uid,
    role: normalizedRole,
    isActive: true,
    createdAt: ts,
    updatedAt: ts
  };

  db.groupMembers.push(member);
  saveDB(db);

  return {
    success: true,
    created: true,
    member,
    memberView: toMemberView(db, member),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    group
  };
}

/**
 * Atualiza papel e/ou status do membro
 */
export function updateMember(groupId, userId, { role, isActive } = {}) {
  const db = loadDB();
  const gid = normalizeGroupId(groupId);
  const uid = normalizeUserId(userId);

  if (!gid) return { error: "groupId inválido (param ausente)." };
  if (!uid && uid !== 0) return { error: "userId inválido." };

  const group = findGroup(db, gid);
  if (!group) return { error: "Grupo não encontrado.", status: 404 };

  const member = findMember(db, gid, uid);
  if (!member) return { error: "Membro não encontrado.", status: 404 };

  if (role !== undefined) member.role = normalizeRole(role);
  if (isActive !== undefined) member.isActive = !!isActive;

  member.updatedAt = nowIso();
  saveDB(db);

  return { success: true, member, memberView: toMemberView(db, member), group };
}

/**
 * Soft delete (desativar)
 */
export function deactivateMember(groupId, userId) {
  return updateMember(groupId, userId, { isActive: false });
}

/**
 * Reativar (resolve o 404 /activate)
 */
export function activateMember(groupId, userId, { role } = {}) {
  const payload = { isActive: true };
  if (role !== undefined) payload.role = role;
  return updateMember(groupId, userId, payload);
}
