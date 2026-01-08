// backend/src/middleware/requireSuperAdmin.js
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

export async function requireSuperAdmin(req, res, next) {
  try {
    const userId = String(req.user?.id || "").trim();
    if (!userId) return res.status(401).json({ error: "Não autenticado." });

    const u = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, isSuperAdmin: true }
    });

    if (!u || u.isActive === false) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    if (u.isSuperAdmin !== true) {
      return res.status(403).json({ error: "Sem permissão (super_admin required)." });
    }

    return next();
  } catch (err) {
    logger.error({ err }, "❌ requireSuperAdmin error");
    return res.status(500).json({ error: "internal_error" });
  }
}
