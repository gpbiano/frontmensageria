// backend/src/middleware/requireSuperAdmin.js
export function requireSuperAdmin(req, res, next) {
  try {
    if (!req?.user) {
      return res.status(401).json({ error: "Não autenticado" });
    }
    if (req.user?.isSuperAdmin !== true) {
      return res.status(403).json({ error: "Acesso restrito (administração)" });
    }
    return next();
  } catch (err) {
    return res.status(500).json({ error: "Erro ao validar super-admin" });
  }
}
