// backend/src/routes/webhooks/asaasWebhookRouter.js
import express from "express";
import crypto from "crypto";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;

const router = express.Router();

/**
 * Se você configurar um segredo no webhook do Asaas, pode validar assinatura aqui (opcional).
 * Caso não use, deixe ASAAS_WEBHOOK_SECRET vazio e a validação fica desligada.
 */
const ASAAS_WEBHOOK_SECRET = String(process.env.ASAAS_WEBHOOK_SECRET || "").trim();

function safeStr(v) {
  return String(v || "").trim();
}

function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * ✅ Validação simples por segredo compartilhado (header = secret).
 * Se você quiser HMAC do payload (mais comum), eu te ajusto depois.
 */
function validateSignature(req) {
  if (!ASAAS_WEBHOOK_SECRET) return true;

  const sig = safeStr(req.headers["x-webhook-signature"] || req.headers["asaas-signature"]);
  if (!sig) return false;

  return timingSafeEq(sig, ASAAS_WEBHOOK_SECRET);
}

function daysBetween(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return ms / (1000 * 60 * 60 * 24);
}

function isWithinTrial(billing, now) {
  if (!billing?.trialEndsAt) return false;
  const t = new Date(billing.trialEndsAt);
  return t.getTime() > now.getTime();
}

/**
 * Normaliza múltiplos nomes possíveis de evento (Asaas pode variar).
 * Mantém compat com o que você já tinha e adiciona eventos comuns.
 */
function normalizeEvent(raw) {
  const e = safeStr(raw).toUpperCase();

  // pagos
  if (e === "PAYMENT_RECEIVED" || e === "PAYMENT_CONFIRMED") return "PAID";

  // atrasos
  if (e === "PAYMENT_OVERDUE") return "OVERDUE";

  // cancelamento/estorno (não vamos bloquear automaticamente aqui, só registrar)
  if (e === "PAYMENT_CANCELED" || e === "PAYMENT_DELETED") return "CANCELED";
  if (e === "PAYMENT_REFUNDED") return "REFUNDED";

  return e || "UNKNOWN";
}

/**
 * Extrai campos de payment em diferentes formatos (defensivo).
 */
function pickPayment(payload) {
  return payload?.payment || payload?.data?.payment || payload?.data || {};
}

/**
 * POST /webhook/asaas
 *
 * Esperado (comum):
 * {
 *   event: "PAYMENT_RECEIVED" | "PAYMENT_OVERDUE" | ...
 *   payment: { subscription: "...", customer: "...", status: "...", id: "...", invoiceUrl: "...", ... }
 * }
 */
router.post("/", express.json({ limit: "5mb" }), async (req, res) => {
  try {
    if (!validateSignature(req)) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const now = new Date();

    const rawEvent = safeStr(req.body?.event);
    const event = normalizeEvent(rawEvent);

    const payment = pickPayment(req.body);
    const subscriptionId = safeStr(payment?.subscription);
    const customerId = safeStr(payment?.customer);

    // urls / ids úteis pra UI
    const paymentId = safeStr(payment?.id);
    const invoiceUrl = safeStr(payment?.invoiceUrl || payment?.invoiceUrlExternal || payment?.bankSlipUrl);
    const bankSlipUrl = safeStr(payment?.bankSlipUrl);
    const pixQrCode = safeStr(payment?.pixQrCode);
    const pixPayload = safeStr(payment?.pixPayload);

    // se não tem subscription/customer, ignora (não temos como mapear)
    if (!subscriptionId && !customerId) {
      return res.json({ ok: true, ignored: true, reason: "missing_subscription_and_customer" });
    }

    // acha billing por subscription ou customer
    const billing = await prisma.tenantBilling.findFirst({
      where: {
        OR: [
          subscriptionId ? { asaasSubscriptionId: subscriptionId } : undefined,
          customerId ? { asaasCustomerId: customerId } : undefined
        ].filter(Boolean)
      }
    });

    if (!billing) {
      return res.json({ ok: true, ignored: true, reason: "billing_not_found" });
    }

    const tenantId = billing.tenantId;

    // ✅ usa graceDaysAfterDue (default 30) — NÃO fixa 30 hardcoded
    const graceDays = Number(billing.graceDaysAfterDue || 30);

    // ======================================================
    // 1) PAGO => ACTIVE (ou TRIALING se ainda estiver no trial)
    // ======================================================
    if (event === "PAID") {
      const stillTrial = isWithinTrial(billing, now);

      await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          // status de acesso
          accessStatus: stillTrial ? "TRIALING" : "ACTIVE",

          // limpa inadimplência
          delinquentSince: null,
          blockedAt: null,
          blockedReason: null,

          // espelho de pagamento
          lastPaymentStatus: "RECEIVED",
          lastPaymentId: paymentId || billing.lastPaymentId,
          lastInvoiceUrl: invoiceUrl || billing.lastInvoiceUrl,
          lastBankSlipUrl: bankSlipUrl || billing.lastBankSlipUrl,
          lastPixQrCode: pixQrCode || billing.lastPixQrCode,
          lastPixPayload: pixPayload || billing.lastPixPayload,

          lastError: null,
          lastSyncAt: now
        }
      });

      return res.json({ ok: true, action: stillTrial ? "paid_trialing" : "paid_activated" });
    }

    // ======================================================
    // 2) OVERDUE => PAST_DUE + delinquentSince
    //    - se passar graceDays => BLOCKED
    // ======================================================
    if (event === "OVERDUE") {
      // se ainda está em trial, normalmente não deve cair aqui,
      // mas se cair, marcamos PAST_DUE mesmo assim (política da plataforma).
      const delinquentSince = billing.delinquentSince ? new Date(billing.delinquentSince) : now;

      // marca como em atraso
      const updated = await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          accessStatus: "PAST_DUE",
          delinquentSince,
          lastPaymentStatus: "OVERDUE",
          lastPaymentId: paymentId || billing.lastPaymentId,
          lastInvoiceUrl: invoiceUrl || billing.lastInvoiceUrl,
          lastBankSlipUrl: bankSlipUrl || billing.lastBankSlipUrl,
          lastPixQrCode: pixQrCode || billing.lastPixQrCode,
          lastPixPayload: pixPayload || billing.lastPixPayload,
          lastSyncAt: now
        }
      });

      const ds = updated.delinquentSince ? new Date(updated.delinquentSince) : null;
      const daysLate = ds ? daysBetween(now, ds) : 0;

      if (ds && daysLate >= graceDays) {
        await prisma.tenantBilling.update({
          where: { tenantId },
          data: {
            accessStatus: "BLOCKED",
            blockedAt: now,
            blockedReason: `overdue_${graceDays}_days`,
            lastSyncAt: now
          }
        });

        return res.json({ ok: true, action: "blocked_overdue", daysLate, graceDays });
      }

      return res.json({ ok: true, action: "marked_past_due", daysLate, graceDays });
    }

    // ======================================================
    // 3) Outros eventos => só espelha o que der, sem mexer no acesso
    // ======================================================
    if (event === "CANCELED") {
      await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          lastPaymentStatus: "CANCELED",
          lastPaymentId: paymentId || billing.lastPaymentId,
          lastInvoiceUrl: invoiceUrl || billing.lastInvoiceUrl,
          lastSyncAt: now
        }
      });
      return res.json({ ok: true, action: "canceled_recorded" });
    }

    if (event === "REFUNDED") {
      await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          lastPaymentStatus: "REFUNDED",
          lastPaymentId: paymentId || billing.lastPaymentId,
          lastInvoiceUrl: invoiceUrl || billing.lastInvoiceUrl,
          lastSyncAt: now
        }
      });
      return res.json({ ok: true, action: "refunded_recorded" });
    }

    // default noop
    await prisma.tenantBilling.update({
      where: { tenantId },
      data: { lastSyncAt: now }
    });

    return res.json({ ok: true, action: "noop", event: rawEvent || "UNKNOWN" });
  } catch (err) {
    logger.error({ err }, "❌ Asaas webhook error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
