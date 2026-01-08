// backend/src/middleware/enforceBillingAccess.js
import prismaMod from "../lib/prisma.js";
import logger from "../logger.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const BLOCK_MESSAGE =
  "Sua conta foi bloqueada, entre em contato com financeiro da GP Labs.";

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

/**
 * ✅ Regras do projeto (schema novo):
 * - accessStatus BLOCKED ou DISABLED => bloqueia
 * - isFree=true => nunca bloqueia por cobrança (mas ainda bloqueia se DISABLED/BLOCKED)
 * - TRIALING: se trialEndsAt venceu e chargeEnabled != true => bloqueia
 * - PAST_DUE: se delinquentSince >= graceDaysAfterDue (default 30) => bloqueia
 */
function isBlockedByBilling(billing) {
  if (!billing) return false; // compat/legacy: sem billing não quebra tudo

  // bloqueio explícito/manual
  if (billing.accessStatus === "BLOCKED" || billing.blockedAt) return true;
  if (billing.accessStatus === "DISABLED") return true;

  // free nunca bloqueia por cobrança/pagamento
  if (billing.isFree === true) return false;

  const now = new Date();

  // trial venceu e ainda não habilitou cobrança (ou não pagou/upgrade)
  if (billing.trialEndsAt) {
    const trialEnd = new Date(billing.trialEndsAt);
    if (now.getTime() > trialEnd.getTime()) {
      if (billing.chargeEnabled !== true) return true;
    }
  }

  // atraso: após N dias (default 30) bloqueia
  if (billing.delinquentSince) {
    const since = new Date(billing.delinquentSince);
    const graceDays = Number(billing.graceDaysAfterDue || 30);
    if (daysBetween(now, since) >= graceDays) return true;
  }

  return false;
}

export async function enforceBillingAccess(req, res, next) {
  try {
    const tenantId = String(req?.tenant?.id || req?.user?.tenantId || "").trim();
    if (!tenantId) return next(); // caminhos sem tenant / fluxo antigo

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        isActive: true,
        billing: {
          select: {
            // schema novo
            accessStatus: true,
            isFree: true,
            chargeEnabled: true,
            trialEndsAt: true,
            delinquentSince: true,
            graceDaysAfterDue: true,
            blockedAt: true
          }
        }
      }
    });

    // tenant inativo => bloqueia (mensagem padrão)
    if (!tenant || tenant.isActive === false) {
      return res.status(403).json({
        error: "account_blocked",
        message: BLOCK_MESSAGE
      });
    }

    const billing = tenant.billing;

    if (isBlockedByBilling(billing)) {
      return res.status(403).json({
        error: "account_blocked",
        message: BLOCK_MESSAGE
      });
    }

    return next();
  } catch (err) {
    logger.error({ err }, "❌ enforceBillingAccess error");
    return res.status(500).json({ error: "internal_error" });
  }
}

export const BILLING_BLOCK_MESSAGE = BLOCK_MESSAGE;
export const _isBlockedByBilling = isBlockedByBilling;
