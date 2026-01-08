// backend/src/routes/webhooks/asaasWebhookRouter.js
import express from "express";
import crypto from "crypto";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * ✅ Asaas (recomendado):
 * Se você configurar "authToken" no webhook do Asaas,
 * ele envia no header:  asaas-access-token: <authToken>
 *
 * Então use ASAAS_WEBHOOK_TOKEN no servidor.
 *
 * (mantive compat com teu ASAAS_WEBHOOK_SECRET e headers antigos, caso já esteja usando)
 */
const ASAAS_WEBHOOK_TOKEN = String(process.env.ASAAS_WEBHOOK_TOKEN || "").trim();
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
 * ✅ Validação por segredo compartilhado (token):
 * - Prioridade: asaas-access-token (padrão Asaas quando usa authToken)
 * - Compat: x-webhook-signature / asaas-signature (se você já usava)
 *
 * Se nenhum segredo estiver configurado, validação fica desligada.
 */
function validateSignature(req) {
  const expected = ASAAS_WEBHOOK_TOKEN || ASAAS_WEBHOOK_SECRET;
  if (!expected) return true;

  const received =
    safeStr(req.headers["asaas-access-token"]) ||
    safeStr(req.headers["x-webhook-signature"]) ||
    safeStr(req.headers["asaas-signature"]);

  if (!received) return false;
  return timingSafeEq(received, expected);
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
 * Normaliza eventos do Asaas
 */
function normalizeEvent(raw) {
  const e = safeStr(raw).toUpperCase();

  // pagos
  if (
    e === "PAYMENT_RECEIVED" ||
    e === "PAYMENT_CONFIRMED" ||
    e === "PAYMENT_RECEIVED_IN_CASH"
  )
    return "PAID";

  // atrasos
  if (e === "PAYMENT_OVERDUE") return "OVERDUE";

  // cancelamento/estorno
  if (e === "PAYMENT_CANCELED" || e === "PAYMENT_DELETED") return "CANCELED";
  if (e === "PAYMENT_REFUNDED") return "REFUNDED";

  return e || "UNKNOWN";
}

/**
 * Extrai payment em formatos possíveis (defensivo)
 */
function pickPayment(payload) {
  if (!payload) return {};
  if (payload.payment) return payload.payment;
  if (payload.data?.payment) return payload.data.payment;
  if (payload.data) return payload.data;
  return payload;
}

/**
 * POST /webhooks/asaas  (quando montado como app.use("/webhooks/asaas", router))
 */
router.post("/", express.json({ limit: "5mb" }), async (req, res) => {
  try {
    if (!validateSignature(req)) {
      return res.status(401).json({ error: "invalid_signature" });
    }

    const now = new Date();

    const rawEvent = safeStr(req.body?.event || req.body?.type);
    const event = normalizeEvent(rawEvent);

    const payment = pickPayment(req.body);

    const subscriptionId = safeStr(payment?.subscription);
    const customerId = safeStr(payment?.customer);

    // urls / ids úteis pra UI
    const paymentId = safeStr(payment?.id);
    const invoiceUrl = safeStr(
      payment?.invoiceUrl || payment?.invoiceUrlExternal || payment?.invoiceUrlCustomer
    );
    const bankSlipUrl = safeStr(payment?.bankSlipUrl || payment?.boletoUrl);
    const pixQrCode = safeStr(payment?.pixQrCode);
    const pixPayload = safeStr(payment?.pixPayload);

    // se não tem subscription/customer, ignora (não temos como mapear)
    if (!subscriptionId && !customerId) {
      return res.json({
        ok: true,
        ignored: true,
        reason: "missing_subscription_and_customer"
      });
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

      return res.json({
        ok: true,
        action: stillTrial ? "paid_trialing" : "paid_activated"
      });
    }

    // ======================================================
    // 2) OVERDUE => PAST_DUE + delinquentSince
    //    - se passar graceDays => BLOCKED
    // ======================================================
    if (event === "OVERDUE") {
      const delinquentSince = billing.delinquentSince
        ? new Date(billing.delinquentSince)
        : now;

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
    // 3) Outros eventos => só espelha, sem mexer no acesso
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
