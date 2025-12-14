import express from "express";
import { loadDB, saveDB } from "../utils/db.js";
import crypto from "crypto";

const router = express.Router();

function nowIso() {
  return new Date().toISOString();
}

function newMsgId(prefix = "msg") {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function ensureConversationMessages(db, conversationId) {
  if (!db.messagesByConversation) db.messagesByConversation = {};
  if (!Array.isArray(db.messagesByConversation[conversationId])) {
    db.messagesByConversation[conversationId] = [];
  }
  return db.messagesByConversation[conversationId];
}

// GET /conversations?status=open|closed|all
router.get("/", (req, res) => {
  const db = loadDB();
  const status = String(req.query.status || "open");

  let items = Array.isArray(db.conversations) ? db.conversations : [];

  if (status !== "all") {
    items = items.filter((c) => (c.status || "open") === status);
  }

  // ordena por updatedAt/createdAt desc
  items.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });

  return res.json(items);
});

// GET /conversations/:id/messages
router.get("/:id/messages", (req, res) => {
  const db = loadDB();
  const id = String(req.params.id);

  const list = ensureConversationMessages(db, id);
  return res.json(list);
});

// POST /conversations/:id/messages  (envio humano/atendente)
router.post("/:id/messages", (req, res) => {
  const db = loadDB();
  const id = String(req.params.id);

  const conv = (db.conversations || []).find((c) => String(c.id) === id);
  if (!conv) return res.status(404).json({ error: "Conversa não encontrada" });
  if (conv.status === "closed") return res.status(410).json({ error: "Conversa encerrada" });

  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "text obrigatório" });

  const msg = {
    id: newMsgId(),
    conversationId: id,
    channel: conv.channel || "webchat",
    from: "agent",          // importante: o widget renderiza "agent"
    type: "text",
    text,
    createdAt: nowIso()
  };

  const list = ensureConversationMessages(db, id);
  list.push(msg);

  conv.updatedAt = nowIso();

  saveDB(db);
  return res.json(msg);
});

export default router;
