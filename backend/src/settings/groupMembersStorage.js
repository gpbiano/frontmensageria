// backend/src/settings/groupMembersStorage.js
// ✅ PRISMA-FIRST (SEM data.json)
// Este módulo era legado (data.json) e agora virou um SHIM com helpers Prisma.
// Mantém API compatível para não quebrar imports antigos.

import logger from "../logger.js";
import prisma from "../lib/prisma.js";

// ----------------------------
// Compat (não existe mais DB JSON)
// ----------------------------
export function loadDB() {
  // legado esperava um objeto "db". Agora não existe.
  return null;
}

export function saveDB() {
  // noop: não escrevemos mais data.json
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
  if (!r) return "member";
  // mantém compat com schema (member|admin), mas não bloqueia outros se você quiser evoluir
  return r;
}

// ----------------------------
// API pública (compat)
// ----------------------------

/**
 * Helpers específicos de Group Members
 * Compat: getGroupMembers(groupId, { includeInactive? })
 * ✅ Agora Prisma-first
 */
export async function getGroupMembers(groupId, { includeInactive = false, tenantId = null } = {}) {
  const gid = String(groupId || "").trim();
  if (!gid) return { db: null, items: [] };

  let tid = tenantId ? String(tenantId) : null;
  if (!tid) tid = await resolveTenantIdByGroupId(gid);

  if (!tid) {
    // grupo não existe (ou sem tenant) -> retorna vazio
    return { db: null, items: [] };
  }

  const where = {
    tenantId: tid,
    groupId: gid,
    ...(includeInactive ? {} : { isActive: true })
  };

  const items = await prisma.groupMember.findMany({
    where,
    orderBy: { updatedAt: "desc" }
  });

  return { db: null, items };
}

/**
 * upsertGroupMember(groupId, userId, patch)
 * patch: { role?, isActive? }
 *
 * ✅ Prisma-first (com garantia de tenantId)
 */
export async function upsertGroupMember(groupId, userId, patch = {}, { tenantId = null } = {}) {
  const gid = String(groupId || "").trim();
  const uid = String(userId || "").trim();

  if (!gid) throw new Error("groupId obrigatório");
  if (!uid) throw new Error("userId obrigatório");

  let tid = tenantId ? String(tenantId) : null;
  if (!tid) tid = await resolveTenantIdByGroupId(gid);
  if (!tid) throw new Error("group_not_found (não foi possível resolver tenantId pelo groupId)");

  const role = patch.role !== undefined ? normalizeRole(patch.role) : undefined;
  const isActive = patch.isActive !== undefined ? !!patch.isActive : undefined;

  // ✅ garante que o grupo pertence ao tenant e está ativo (opcional, mas seguro)
  const group = await prisma.group.findFirst({
    where: { id: gid, tenantId: tid },
    select: { id: true }
  });
  if (!group) throw new Error("group_not_found_or_forbidden");

  // ✅ garante que o usuário existe (opcional, mas ajuda a evitar lixo)
  const user = await prisma.user.findFirst({
    where: { id: uid },
    select: { id: true }
  });
  if (!user) throw new Error("user_not_found");

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

  return { db: null, member };
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
