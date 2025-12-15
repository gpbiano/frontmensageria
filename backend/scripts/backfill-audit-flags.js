import fs from "fs";
import path from "path";

const DB_FILE = path.join(process.cwd(), "data.json");

const db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
db.conversations = db.conversations || [];
db.messagesByConversation = db.messagesByConversation || {};

for (const c of db.conversations) {
  const id = String(c.id);
  const msgs = Array.isArray(db.messagesByConversation[id]) ? db.messagesByConversation[id] : [];

  const hadBot = msgs.some((m) => m?.isBot || String(m?.from || "").toLowerCase() === "bot");
  const hadHuman = msgs.some((m) => String(m?.from || "").toLowerCase() === "agent");

  if (hadBot) c.hadBot = true;
  if (hadHuman) c.hadHuman = true;
}

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
console.log("✅ backfill concluído: hadBot/hadHuman");
