// backend/src/middleware/requireTenantAccess.js
import logger from "../logger.js";
import prismaMod from "../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const BLOCK_MSG = "Sua conta foi bloqueada, entre em contato com financeiro da GP Labs.";

function now() {
  return new Date();
}

function isAfter(a, b) {
  return a && b && a.getTime() > b.getTime();
}

export async function requireTenantAccess(req, res, next) {
  try {
    const tenantId = req?.tenant?.id || req?.user?.tenantId;
    if (!tenantId) return res.status(400).json({ error: "tenant_not_resolved" });

    const billing = await prisma.tenantBilling.findUnique({
      where: { tenantId: String(tenantId) },
      select: {
        accessStatus: true,
        trialEndsAt: true,
        delinquentSince: true,
        graceDaysAfterDue: true,
        blockedAt: true,
        blockedReason: true,
        isFree: true,
        chargeEnabled: true
      }
    });

    // fail-safe: se não existe billing ainda, deixa passar (ou bloqueia, se preferir)
    if (!billing) return next();

    // Bloqueios explícitos
    if (billing.accessStatus === "BLOCKED" || billing.accessStatus === "DISABLED") {
      return res.status(403).json({
        error: "tenant_blocked",
        message: BLOCK_MSG
      });
    }

    // Regra: TRIAL acabou e não virou ACTIVE => bloqueia
    // (Você vai marcar ACTIVE via webhook quando receber pagamento)
    if (billing.accessStatus === "TRIALING" && billing.trialEndsAt) {
      const ended = isAfter(now(), billing.trialEndsAt);
      if (ended) {
        // bloqueia no banco
        await prisma.tenantBilling.update({
          where: { tenantId: String(tenantId) },
          data: {
            accessStatus: "BLOCKED",
            blockedAt: now(),
            blockedReason: "trial_expired_no_payment"
          }
        });

        return res.status(403).json({
          error: "tenant_blocked",
          message: BLOCK_MSG
        });
      }
    }

    // Regra: PAST_DUE com 30 dias (ou graceDaysAfterDue) => bloqueia
    if (billing.delinquentSince) {
      const grace = Number(billing.graceDaysAfterDue || 30);
      const limit = new Date(billing.delinquentSince);
      limit.setDate(limit.getDate() + grace);

      if (isAfter(now(), limit)) {
        await prisma.tenantBilling.update({
          where: { tenantId: String(tenantId) },
          data: {
            accessStatus: "BLOCKED",
            blockedAt: now(),
            blockedReason: "past_due_over_grace"
          }
        });

        return res.status(403).json({
          error: "tenant_blocked",
          message: BLOCK_MSG
        });
      }
    }

    return next();
  } catch (err) {
    logger.error({ err }, "❌ requireTenantAccess error");
    return res.status(500).json({ error: "internal_error" });
  }
}
