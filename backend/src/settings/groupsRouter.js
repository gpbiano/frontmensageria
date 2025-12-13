// backend/src/settings/groupsRouter.js
import express from "express";
import crypto from "crypto";
import { loadDB, saveDB, ensureArray } from "../utils/db.js";
import { requireAuth, requireRole } from "../middleware/requireAuth.js";

// ✅ members router (default export)
import groupMembersRouter from "./groupMembersRouter.js";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = "grp") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function normalizeName(name) {
  return String(name || "").trim();
}

// ======================================================
// ✅ MOUNT MEMBERS
// /settings/groups/:id/members/*
// ======================================================
router.use("/:id/members", groupMembersRouter);

// ======================================================
// ✅ GET /settings/groups
// Lista grupos
// Query: includeInactive=true|false
// ======================================================
router.get("/", requireAuth, requireRole("admin", "manager"), (req, res) => {
  const db = loadDB();
  db.groups = ensureArray(db.groups);

  const includeInactive = String(req.query.includeInactive || "false") === "true";

  const items = includeInactive
    ? db.groups
    : db.groups.filter((g) => g?.isActive !== false);

  return res.json({ items, total: items.length });
});

// ======================================================
// ✅ POST /settings/groups
// Cria grupo
// (admin)
// Body: { name, color?, slaMinutes? }
// ======================================================
router.post("/", requireAuth, requireRole("admin"), (req, res) => {
  const db = loadDB();
  db.groups = ensureArray(db.groups);

  const name = normalizeName(req.body?.name);
  if (!name) {
    return res.status(400).json({ error: "Nome do grupo é obrigatório." });
  }

  const group = {
    id: newId("grp"),
    name,
    color: String(req.body?.color || "#22c55e"),
    slaMinutes: Number(req.body?.slaMinutes ?? 10),
    isActive: true,
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  db.groups.push(group);
  saveDB(db);

  return res.status(201).json(group);
});

// ======================================================
// ✅ PATCH /settings/groups/:id
// Edita grupo
// (admin)
// Body: { name?, color?, slaMinutes? }
// ======================================================
router.patch("/:id", requireAuth, requireRole("admin"), (req, res) => {
  const db = loadDB();
  db.groups = ensureArray(db.groups);

  const group = db.groups.find((g) => String(g.id) === String(req.params.id));
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  if (req.body?.name !== undefined) {
    const name = normalizeName(req.body.name);
    if (!name) return res.status(400).json({ error: "Nome inválido." });
    group.name = name;
  }

  if (req.body?.color !== undefined) {
    group.color = String(req.body.color || "#22c55e");
  }

  if (req.body?.slaMinutes !== undefined) {
    group.slaMinutes = Number(req.body.slaMinutes ?? 10);
  }

  group.updatedAt = nowIso();
  saveDB(db);

  return res.json(group);
});

// ======================================================
// ✅ PATCH /settings/groups/:id/deactivate
// Desativa grupo
// (admin)
// ======================================================
router.patch("/:id/deactivate", requireAuth, requireRole("admin"), (req, res) => {
  const db = loadDB();
  db.groups = ensureArray(db.groups);

  const group = db.groups.find((g) => String(g.id) === String(req.params.id));
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  group.isActive = false;
  group.updatedAt = nowIso();
  saveDB(db);

  return res.json({ ok: true, group });
});

// ======================================================
// ✅ PATCH /settings/groups/:id/activate
// Ativa grupo
// (admin)
// ======================================================
router.patch("/:id/activate", requireAuth, requireRole("admin"), (req, res) => {
  const db = loadDB();
  db.groups = ensureArray(db.groups);

  const group = db.groups.find((g) => String(g.id) === String(req.params.id));
  if (!group) return res.status(404).json({ error: "Grupo não encontrado." });

  group.isActive = true;
  group.updatedAt = nowIso();
  saveDB(db);

  return res.json({ ok: true, group });
});

export default router;
