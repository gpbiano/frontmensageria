// backend/src/settings/groupMembersStorage.js
// ✅ PRISMA-FIRST (SEM data.json)
// SHIM compatível para imports antigos (legado usava data.json).
// Agora tudo é Postgres via Prisma.

import logger from "../logger.js";
import prisma from "../lib/prisma.js";

// ----------------------------
// Compat (legado esperava db)
// ----------------------------
export function loadDB() {
  // Retorna um "db" neutro para não quebrar código legado que faz:
  // const { db, items } = getGroupMembers(...)
  return { _legacy: true };
}

export function saveDB() {
  // noop: não existe mais data.json
  return true;
}

// helper simples (mantém padrão que você usa)
export function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

// ----------------------------
// Helpers internos
// ----------------------------
async function resolveTenantIdByGroupId(groupId) {
  const gid = String(groupId || "").trim();
  if (!gid) return null;

  const g = await prisma.group.findUnique({
    where: { id: gid },
    select: { tenantId: true }
  });

  return g?.tenantId ? String(g.tenantId) : null;
}

function normalizeRole(role) {
  const r = String(role || "").trim().toLowerCase();
  // Alinha com schema: member | admin
  if (r === "admin") return "admin";
  return "member";
}

// ----------------------------
// API pública (compat)
// ----------------------------

/**
 * getGroupMembers(groupId, { includeInactive?, tenantId? })
 * ✅ Prisma-first
 */
export async function getGroupMembers(
  groupId,
  { includeInactive = false, tenantId = null } = {}
) {
  const gid = String(groupId || "").trim();
  if (!gid) return { db: loadDB(), items: [] };

  let tid = tenantId ? String(tenantId) : null;
  if (!tid) tid = await resolveTenantIdByGroupId(gid);

  if (!tid) {
    // grupo não existe (ou sem tenant) -> retorna vazio (compat)
    return { db: loadDB(), items: [] };
  }

  const items = await prisma.groupMember.findMany({
    where: {
      tenantId: tid,
      groupId: gid,
      ...(includeInactive ? {} : { isActive: true })
    },
    orderBy: { updatedAt: "desc" }
  });

  return { db: loadDB(), items };
}

/**
 * upsertGroupMember(groupId, userId, patch, opts)
 * patch: { role?, isActive? }
 * opts: { tenantId? }
 */
export async function upsertGroupMember(
  groupId,
  userId,
  patch = {},
  { tenantId = null } = {}
) {
  const gid = String(groupId || "").trim();
  const uid = String(userId || "").trim();

  if (!gid) throw new Error("groupId obrigatório");
  if (!uid) throw new Error("userId obrigatório");

  let tid = tenantId ? String(tenantId) : null;
  if (!tid) tid = await resolveTenantIdByGroupId(gid);
  if (!tid) throw new Error("group_not_found");

  // ✅ valida grupo pertence ao tenant
  const groupOk = await prisma.group.findFirst({
    where: { id: gid, tenantId: tid },
    select: { id: true }
  });
  if (!groupOk) throw new Error("group_not_found_or_forbidden");

  // ✅ valida usuário existe
  const userOk = await prisma.user.findUnique({
    where: { id: uid },
    select: { id: true }
  });
  if (!userOk) throw new Error("user_not_found");

  const role =
    patch.role !== undefined ? normalizeRole(patch.role) : undefined;

  const isActive =
    patch.isActive !== undefined ? !!patch.isActive : undefined;

  const member = await prisma.groupMember.upsert({
    where: {
      tenantId_groupId_userId: {
        tenantId: tid,
        groupId: gid,
        userId: uid
      }
    },
    create: {
      tenantId: tid,
      groupId: gid,
      userId: uid,
      role: role ?? "member",
      isActive: isActive ?? true
    },
    update: {
      ...(role !== undefined ? { role } : {}),
      ...(isActive !== undefined ? { isActive } : {})
    }
  });

  return { db: loadDB(), member };
}

export async function deactivateGroupMember(groupId, userId, opts = {}) {
  try {
    return await upsertGroupMember(groupId, userId, { isActive: false }, opts);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ deactivateGroupMember failed");
    throw err;
  }
}

export async function activateGroupMember(groupId, userId, role, opts = {}) {
  const patch = { isActive: true };
  if (role !== undefined) patch.role = role;

  try {
    return await upsertGroupMember(groupId, userId, patch, opts);
  } catch (err) {
    logger.error({ err: err?.message || err }, "❌ activateGroupMember failed");
    throw err;
  }
}
