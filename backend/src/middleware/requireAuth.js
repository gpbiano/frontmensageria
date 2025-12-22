// backend/src/middleware/requireAuth.js
// ... mantém tudo que você já tem acima

export function requireRole(...allowed) {
  const allowedSet = new Set(
    allowed
      .flat()
      .filter(Boolean)
      .map((r) => String(r).toLowerCase())
  );

  return function requireRoleMiddleware(req, res, next) {
    const role = String(req.user?.role || "").toLowerCase();

    if (!role) {
      return res.status(401).json({ error: "Não autenticado." });
    }

    // Se não passou roles, não bloqueia (fail-safe)
    if (allowedSet.size === 0) return next();

    if (!allowedSet.has(role)) {
      return res.status(403).json({
        error: "Sem permissão.",
        required: Array.from(allowedSet),
        current: role
      });
    }

    return next();
  };
}
