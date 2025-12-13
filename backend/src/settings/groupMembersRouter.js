// backend/src/settings/groupMembersRouter.js
import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

const router = express.Router({ mergeParams: true });

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

function getGroupId(req) {
  return req.params.id || req.params.groupId || null;
}

function findGroup(db, groupId) {
  db.groups = ensureArray(db.groups);
  return db.groups.find((g) => String(g.id) === String(groupId)) || null;
}

function findUser(db, userId) {
  db.users = ensureArray(db.users);
  return db.users.find((u) => String(u.id) === String(userId)) || null;
}

/**
 * GET /settings/groups/:id/members
 */
router.get("/", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  const groupId = getGroupId(req);

  if (!groupId) {
    return res.status(400).json({ error: "groupId inválido (param ausente)." });
  }

  const group = findGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  db.groupMembers = ensureArray(db.groupMembers);
  db.users = ensureArray(db.users);

  const includeInactive = String(req.query.includeInactive || "false") === "true";

  const members = db.groupMembers
    .filter((m) => String(m.groupId) === String(groupId))
    .filter((m) => (includeInactive ? true : m.isActive !== false))
    .map((m) => {
      const u = findUser(db, m.userId);
      return {
        id: m.id,
        groupId: m.groupId,
        userId: m.userId,
        memberRole: m.role || "agent",
        isActive: m.isActive !== false,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
        name: u?.name || "Usuário removido",
        email: u?.email || "",
        userRole: u?.role || "agent",
        userIsActive: u?.isActive !== false
      };
    });

  return res.json({ items: members, total: members.length, group });
});

/**
 * POST /settings/groups/:id/members
 * Body: { userId, role }
 */
router.post("/", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  const groupId = getGroupId(req);

  if (!groupId) {
    return res.status(400).json({ error: "groupId inválido (param ausente)." });
  }

  const group = findGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  const userId = req.body?.userId;
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    return res.status(400).json({ error: "userId é obrigatório." });
  }

  const user = findUser(db, userId);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

  db.groupMembers = ensureArray(db.groupMembers);

  const role = normalizeRole(req.body?.role);
  const ts = nowIso();

  const existing = db.groupMembers.find(
    (m) =>
      String(m.groupId) === String(groupId) &&
      String(m.userId) === String(userId)
  );

  if (existing) {
    existing.role = role;
    existing.isActive = true;
    existing.updatedAt = ts;
    saveDB(db);

    return res.status(200).json({
      success: true,
      member: existing,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  }

  const member = {
    id: newId("gm"),
    groupId: String(groupId),
    userId: Number(userId),
    role,
    isActive: true,
    createdAt: ts,
    updatedAt: ts
  };

  db.groupMembers.push(member);
  saveDB(db);

  return res.status(201).json({
    success: true,
    member,
    user: { id: user.id, name: user.name, email: user.email, role: user.role }
  });
});

router.patch("/:userId", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  const groupId = getGroupId(req);

  if (!groupId) {
    return res.status(400).json({ error: "groupId inválido (param ausente)." });
  }

  const group = findGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  const userId = req.params.userId;

  db.groupMembers = ensureArray(db.groupMembers);

  const member = db.groupMembers.find(
    (m) =>
      String(m.groupId) === String(groupId) &&
      String(m.userId) === String(userId)
  );
  if (!member) return res.status(404).json({ error: "Membro não encontrado." });

  if (req.body?.role !== undefined) member.role = normalizeRole(req.body.role);
  if (req.body?.isActive !== undefined) member.isActive = !!req.body.isActive;

  member.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, member });
});

router.patch("/:userId/deactivate", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  const groupId = getGroupId(req);

  if (!groupId) {
    return res.status(400).json({ error: "groupId inválido (param ausente)." });
  }

  const group = findGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  const userId = req.params.userId;

  db.groupMembers = ensureArray(db.groupMembers);

  const member = db.groupMembers.find(
    (m) =>
      String(m.groupId) === String(groupId) &&
      String(m.userId) === String(userId)
  );
  if (!member) return res.status(404).json({ error: "Membro não encontrado." });

  member.isActive = false;
  member.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, member });
});

router.patch("/:userId/activate", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  const groupId = getGroupId(req);

  if (!groupId) {
    return res.status(400).json({ error: "groupId inválido (param ausente)." });
  }

  const group = findGroup(db, groupId);
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  const userId = req.params.userId;

  db.groupMembers = ensureArray(db.groupMembers);

  const member = db.groupMembers.find(
    (m) =>
      String(m.groupId) === String(groupId) &&
      String(m.userId) === String(userId)
  );
  if (!member) return res.status(404).json({ error: "Membro não encontrado." });

  member.isActive = true;
  if (req.body?.role !== undefined) member.role = normalizeRole(req.body.role);

  member.updatedAt = nowIso();
  saveDB(db);

  return res.json({ success: true, member });
});

export default router;
