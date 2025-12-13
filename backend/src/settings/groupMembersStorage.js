// backend/src/settings/groupMembersStorage.js
import fs from "fs";
import path from "path";

const DB_FILE = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(process.cwd(), "data.json");

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      const initial = {
        users: [],
        passwordTokens: [],
        contacts: [],
        conversations: [],
        messagesByConversation: {},
        settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
        outboundCampaigns: [],
        groups: [],
        groupMembers: []
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), "utf8");
      return initial;
    }

    const raw = fs.readFileSync(DB_FILE, "utf8");
    const db = safeJsonParse(raw, {});

    // garante arrays
    if (!Array.isArray(db.users)) db.users = [];
    if (!Array.isArray(db.groups)) db.groups = [];
    if (!Array.isArray(db.groupMembers)) db.groupMembers = [];
    if (!Array.isArray(db.passwordTokens)) db.passwordTokens = [];
    if (!Array.isArray(db.contacts)) db.contacts = [];
    if (!Array.isArray(db.conversations)) db.conversations = [];
    if (!db.messagesByConversation || typeof db.messagesByConversation !== "object")
      db.messagesByConversation = {};
    if (!db.settings) db.settings = { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] };
    if (!Array.isArray(db.outboundCampaigns)) db.outboundCampaigns = [];

    return db;
  } catch (err) {
    // fallback seguro
    return {
      users: [],
      passwordTokens: [],
      contacts: [],
      conversations: [],
      messagesByConversation: {},
      settings: { tags: ["Vendas", "Suporte", "Reclamação", "Financeiro"] },
      outboundCampaigns: [],
      groups: [],
      groupMembers: []
    };
  }
}

export function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// helper simples (mesmo padrão que você usa)
export function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

/**
 * Helpers específicos de Group Members
 */
export function getGroupMembers(groupId, { includeInactive = false } = {}) {
  const db = loadDB();
  db.groupMembers = ensureArray(db.groupMembers);

  const items = db.groupMembers
    .filter((m) => String(m.groupId) === String(groupId))
    .filter((m) => (includeInactive ? true : m.isActive !== false));

  return { db, items };
}

export function upsertGroupMember(groupId, userId, patch = {}) {
  const db = loadDB();
  db.groupMembers = ensureArray(db.groupMembers);

  const now = new Date().toISOString();

  let member = db.groupMembers.find(
    (m) =>
      String(m.groupId) === String(groupId) &&
      String(m.userId) === String(userId)
  );

  if (!member) {
    member = {
      id: `gm_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      groupId: String(groupId),
      userId: Number(userId),
      role: "agent",
      isActive: true,
      createdAt: now,
      updatedAt: now
    };
    db.groupMembers.push(member);
  }

  if (patch.role !== undefined) member.role = String(patch.role);
  if (patch.isActive !== undefined) member.isActive = !!patch.isActive;

  member.updatedAt = now;

  saveDB(db);
  return { db, member };
}

export function deactivateGroupMember(groupId, userId) {
  return upsertGroupMember(groupId, userId, { isActive: false });
}

export function activateGroupMember(groupId, userId, role) {
  const patch = { isActive: true };
  if (role !== undefined) patch.role = role;
  return upsertGroupMember(groupId, userId, patch);
}
