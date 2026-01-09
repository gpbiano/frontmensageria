// backend/src/routes/webhooks/asaasWebhookRouter.js
import express from "express";
import crypto from "crypto";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";
import { sendEmailResend } from "../../services/mailer.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * ✅ Asaas:
 * Se você configurar "authToken" no webhook do Asaas,
 * ele envia no header:  asaas-access-token: <authToken>
 *
 * Então use ASAAS_WEBHOOK_TOKEN no servidor.
 *
 * (mantive compat com teu ASAAS_WEBHOOK_SECRET e headers antigos)
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

function normalizeEvent(raw) {
  const e = safeStr(raw).toUpperCase();

  if (e === "PAYMENT_RECEIVED" || e === "PAYMENT_CONFIRMED" || e === "PAYMENT_RECEIVED_IN_CASH") return "PAID";
  if (e === "PAYMENT_OVERDUE") return "OVERDUE";
  if (e === "PAYMENT_CANCELED" || e === "PAYMENT_DELETED") return "CANCELED";
  if (e === "PAYMENT_REFUNDED") return "REFUNDED";

  return e || "UNKNOWN";
}

function pickPayment(payload) {
  if (!payload) return {};
  if (payload.payment) return payload.payment;
  if (payload.data?.payment) return payload.data.payment;
  if (payload.data) return payload.data;
  return payload;
}

// -------------------------------
// Invite URL + token
// -------------------------------
function getAppWebUrl() {
  return (
    safeStr(process.env.APP_WEB_URL) ||
    safeStr(process.env.FRONTEND_URL) ||
    safeStr(process.env.PUBLIC_APP_URL) ||
    ""
  );
}

function getInvitePath() {
  // ✅ sua tela atual pega token por querystring
  // /auth/create-password?token=...
  return safeStr(process.env.INVITE_PATH) || "/auth/create-password";
}

function buildInviteUrl(token) {
  const base = getAppWebUrl();
  const path = getInvitePath();
  if (!base) return "";
  const u = new URL(path, base);
  u.searchParams.set("token", String(token || ""));
  return u.toString();
}

function addDays(days) {
  const d = new Date();
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

async function getPrimaryAdminEmail(tenantId) {
  // tenta pegar um admin do tenant
  const m = await prisma.userTenant.findFirst({
    where: { tenantId: String(tenantId), isActive: true, role: "admin" },
    orderBy: [{ createdAt: "asc" }],
    include: { user: { select: { email: true, name: true } } }
  });

  const email = safeStr(m?.user?.email);
  const name = safeStr(m?.user?.name);

  return email ? { email, name: name || null } : null;
}

async function ensureInviteToken({ tenantId, userId, ttlDays = 7 }) {
  const now = new Date();

  // tenta reutilizar um token válido
  const existing = await prisma.passwordToken.findFirst({
    where: {
      tenantId: String(tenantId),
      userId: String(userId),
      type: "invite",
      used: false,
      expiresAt: { gt: now }
    },
    orderBy: [{ createdAt: "desc" }]
  });

  if (existing?.token) return existing;

  // cria novo
  const expiresAt = addDays(ttlDays);
  return prisma.passwordToken.create({
    data: {
      tenantId: String(tenantId),
      userId: String(userId),
      type: "invite",
      expiresAt,
      used: false
      // token gerado no schema
    }
  });
}

async function sendPaidWelcomeEmail({ to, tenantName, inviteUrl, paymentId, invoiceUrl }) {
  const subject = `Pagamento recebido — seja bem-vindo à GP Labs`;

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.4">
    <h2 style="margin:0 0 10px">Pagamento recebido ✅</h2>
    <p style="margin:0 0 10px">
      Recebemos seu pagamento e sua empresa <b>${String(tenantName || "GP Labs")}</b> já está liberada para acesso.
    </p>

    ${
      inviteUrl
        ? `<p style="margin:14px 0 10px">Agora é só criar sua senha:</p>
           <p style="margin:14px 0">
             <a href="${inviteUrl}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">
               Criar senha e acessar
             </a>
           </p>
           <p style="margin:0;color:#475569;font-size:12px">
             Se o botão não abrir, copie e cole no navegador:<br/>
             <span style="word-break:break-all">${inviteUrl}</span>
           </p>`
        : `<p style="margin:0;color:#b45309">
             Link não configurado no servidor (APP_WEB_URL/INVITE_PATH). Peça ao suporte para gerar um novo convite.
           </p>`
    }

    ${
      invoiceUrl
        ? `<p style="margin:12px 0 0;color:#64748b;font-size:12px">
             Comprovante/fatura: <span style="word-break:break-all">${invoiceUrl}</span>
           </p>`
        : ""
    }

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
    <p style="margin:0;color:#64748b;font-size:12px">
      ID do pagamento: ${String(paymentId || "-")}
    </p>
  </div>
  `;

  return sendEmailResend({ to, subject, html });
}

/**
 * POST /webhooks/asaas
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

    const paymentId = safeStr(payment?.id);
    const invoiceUrl = safeStr(
      payment?.invoiceUrl || payment?.invoiceUrlExternal || payment?.invoiceUrlCustomer
    );
    const bankSlipUrl = safeStr(payment?.bankSlipUrl || payment?.boletoUrl);
    const pixQrCode = safeStr(payment?.pixQrCode);
    const pixPayload = safeStr(payment?.pixPayload);

    if (!subscriptionId && !customerId) {
      return res.json({ ok: true, ignored: true, reason: "missing_subscription_and_customer" });
    }

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

    // ✅ usa graceDaysAfterDue (default 30)
    const graceDays = Number(billing.graceDaysAfterDue || 30);

    // ======================================================
    // 1) PAGO => ACTIVE/TRIALING + e-mail (Resend)
    // ======================================================
    if (event === "PAID") {
      const stillTrial = isWithinTrial(billing, now);

      // ✅ idempotência de e-mail:
      // se já processou esse paymentId como RECEIVED, não reenvia
      const alreadyProcessedSamePayment =
        paymentId &&
        safeStr(billing.lastPaymentId) === paymentId &&
        safeStr(billing.lastPaymentStatus) === "RECEIVED";

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
          lastSyncAt: now,

          // se você usa status da integração também, ajuda a UI:
          status: "SYNCED"
        }
      });

      // ✅ e-mail somente se ainda não foi processado o mesmo pagamento
      if (!alreadyProcessedSamePayment) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

          // pega admin principal (ou fallback)
          const admin = await getPrimaryAdminEmail(tenantId);
          const to = admin?.email || safeStr(billing.billingEmail);

          if (to && to.includes("@")) {
            // precisa do userId para token
            const adminMember = await prisma.userTenant.findFirst({
              where: { tenantId: String(tenantId), isActive: true, role: "admin" },
              orderBy: [{ createdAt: "asc" }],
              select: { userId: true }
            });

            if (adminMember?.userId) {
              const tokenRow = await ensureInviteToken({
                tenantId,
                userId: adminMember.userId,
                ttlDays: 7
              });

              const inviteUrl = buildInviteUrl(tokenRow.token);

              await sendPaidWelcomeEmail({
                to,
                tenantName: tenant?.name || "GP Labs",
                inviteUrl,
                paymentId,
                invoiceUrl
              });
            } else {
              logger.warn({ tenantId }, "asaas webhook: não encontrou admin userTenant para enviar convite");
            }
          } else {
            logger.warn({ tenantId }, "asaas webhook: sem e-mail válido para envio (admin/billingEmail)");
          }
        } catch (mailErr) {
          logger.error({ mailErr }, "asaas webhook: falha ao enviar e-mail pós-pagamento (não bloqueia fluxo)");
        }
      }

      return res.json({
        ok: true,
        action: stillTrial ? "paid_trialing" : "paid_activated",
        emailed: !alreadyProcessedSamePayment
      });
    }

    // ======================================================
    // 2) OVERDUE => PAST_DUE + delinquentSince
    //    - se passar graceDays => BLOCKED
    // ======================================================
    if (event === "OVERDUE") {
      const delinquentSince = billing.delinquentSince ? new Date(billing.delinquentSince) : now;

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
