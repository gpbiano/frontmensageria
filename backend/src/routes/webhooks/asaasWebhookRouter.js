// backend/src/routes/webhooks/asaasWebhookRouter.js
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import logger from "../../logger.js";
import prismaMod from "../../lib/prisma.js";

const prisma = prismaMod?.prisma || prismaMod?.default || prismaMod;
const router = express.Router();

/**
 * ✅ TOKEN/SECRET DO WEBHOOK (sem cache “perigoso”):
 * - lê de process.env sempre que validar (pra evitar ficar preso em "")
 * - aceita ASAAS_WEBHOOK_TOKEN ou ASAAS_WEBHOOK_SECRET
 */
function getWebhookSecret() {
  const a = String(process.env.ASAAS_WEBHOOK_TOKEN || "").trim();
  const b = String(process.env.ASAAS_WEBHOOK_SECRET || "").trim();
  return a || b || "";
}

function safeStr(v) {
  return String(v || "").trim();
}

function timingSafeEq(a, b) {
  const aa = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * ✅ Validação compatível com o que você mostrou no LOG:
 * - Asaas mandou: header "asaas-access-token": "...."
 * - então validamos por ele primeiro
 * - também aceitamos "x-webhook-signature" / "asaas-signature" (fallback)
 *
 * Política:
 * - Se não existir secret no env -> NÃO bloqueia (permite webhook) [útil em dev]
 * - Se existir secret no env -> exige header e compara timing-safe
 */
function validateSignature(req) {
  const expected = getWebhookSecret();
  if (!expected) return true; // sem segredo configurado -> não bloqueia

  const received =
    safeStr(req.headers["asaas-access-token"]) ||
    safeStr(req.headers["x-webhook-signature"]) ||
    safeStr(req.headers["asaas-signature"]) ||
    safeStr(req.headers["x-asaas-access-token"]);

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

  // ✅ principais eventos de pagamento
  if (
    e === "PAYMENT_RECEIVED" ||
    e === "PAYMENT_CONFIRMED" ||
    e === "PAYMENT_RECEIVED_IN_CASH"
  )
    return "PAID";

  if (e === "PAYMENT_OVERDUE") return "OVERDUE";
  if (e === "PAYMENT_CANCELED" || e === "PAYMENT_DELETED") return "CANCELED";
  if (e === "PAYMENT_REFUNDED") return "REFUNDED";

  // alguns webhooks vêm como INVOICE_* ou SUBSCRIPTION_*
  return e || "UNKNOWN";
}

function pickPayment(payload) {
  if (!payload) return {};
  if (payload.payment) return payload.payment;
  if (payload.data?.payment) return payload.data.payment;
  if (payload.data) return payload.data;
  return payload;
}

// ===============================
// Invite URL
// ===============================
function getAppWebUrl() {
  return (
    safeStr(process.env.APP_WEB_URL) ||
    safeStr(process.env.FRONTEND_URL) ||
    safeStr(process.env.PUBLIC_APP_URL) ||
    ""
  );
}

function getInvitePath() {
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

// ===============================
// Resend
// ===============================
async function sendResendEmailIfConfigured({ to, subject, html }) {
  const RESEND_API_KEY = safeStr(process.env.RESEND_API_KEY);
  const RESEND_FROM =
    safeStr(process.env.RESEND_FROM) ||
    safeStr(process.env.MAIL_FROM) ||
    safeStr(process.env.SMTP_FROM) ||
    "";

  if (!RESEND_API_KEY || !RESEND_FROM) {
    logger.warn(
      { RESEND_API_KEY: Boolean(RESEND_API_KEY), RESEND_FROM: Boolean(RESEND_FROM) },
      "resend: não configurado (pulando envio)"
    );
    return { sent: false, reason: "resend_not_configured" };
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        subject,
        html
      })
    });

    const text = await resp.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    if (!resp.ok) {
      logger.error({ status: resp.status, json }, "resend: falha ao enviar");
      return { sent: false, reason: "send_failed", status: resp.status, payload: json };
    }

    return { sent: true, id: json?.id || null };
  } catch (err) {
    logger.error({ err }, "resend: erro inesperado");
    return { sent: false, reason: "exception" };
  }
}

async function sendPaymentWelcomeEmail({ to, tenantName, inviteUrl, expiresAt }) {
  const subject = "Pagamento recebido — Bem-vindo(a) à GP Labs 🎉";
  const exp = expiresAt ? new Date(expiresAt).toLocaleString("pt-BR") : "";

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; line-height:1.45">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
      <div style="width:44px;height:44px;border-radius:12px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">GP</div>
      <div>
        <div style="font-size:16px;font-weight:800">GP Labs</div>
        <div style="font-size:12px;color:#475569">WhatsApp • Automação • Atendimento</div>
      </div>
    </div>

    <h2 style="margin:0 0 10px">Pagamento confirmado ✅</h2>
    <p style="margin:0 0 8px">
      A assinatura da empresa <b>${String(tenantName || "sua empresa")}</b> foi confirmada.
    </p>
    <p style="margin:0 0 14px">
      Para ativar seu usuário e acessar a plataforma, crie sua senha:
    </p>

    <p style="margin:16px 0">
      <a href="${inviteUrl}" style="display:inline-block;padding:12px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:12px;font-weight:700">
        Criar senha e acessar
      </a>
    </p>

    <p style="margin:0 0 10px;color:#475569;font-size:12px">
      Se o botão não funcionar, copie e cole no navegador:<br/>
      <span style="word-break:break-all">${inviteUrl}</span>
    </p>

    ${exp ? `<p style="margin:10px 0 0;color:#475569;font-size:12px">Este link expira em: ${exp}</p>` : ""}

    <hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0"/>
    <p style="margin:0;color:#64748b;font-size:12px">
      Se você não esperava este e-mail, pode ignorar.
    </p>
  </div>
  `;

  return sendResendEmailIfConfigured({ to, subject, html });
}

/**
 * ✅ Observação sobre o 401 que você viu:
 * - No log: o Asaas mandou o header `asaas-access-token`
 * - Você recebeu 401 => validateSignature retornou false
 *
 * Causas mais comuns:
 * 1) ASAAS_WEBHOOK_TOKEN/SECRET no servidor NÃO bate com o token configurado no Asaas
 * 2) env não carregou (ficou vazio) e você estava comparando com valor errado
 *
 * Aqui garantimos:
 * - leitura on-demand do env
 * - suporte explícito ao header `asaas-access-token`
 */
router.post("/", express.json({ limit: "5mb" }), async (req, res) => {
  try {
    // ✅ valida assinatura
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

    // Sem assinatura/subscription o evento não amarra no tenant
    if (!subscriptionId && !customerId) {
      return res.json({
        ok: true,
        ignored: true,
        reason: "missing_subscription_and_customer"
      });
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
    const graceDays = Number(billing.graceDaysAfterDue || 30);

    // ======================================================
    // PAID => libera acesso + manda e-mail se era awaiting_first_payment
    // ======================================================
    if (event === "PAID") {
      const stillTrial = isWithinTrial(billing, now);

      // se tem trialEndsAt no billing, e ainda não passou, fica TRIALING, senão ACTIVE
      const nextAccess = stillTrial ? "TRIALING" : "ACTIVE";

      const wasAwaitingFirstPayment =
        String(billing.accessStatus || "") === "BLOCKED" &&
        String(billing.blockedReason || "").startsWith("awaiting_first_payment");

      // ✅ atualiza billing
      await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          accessStatus: nextAccess,

          delinquentSince: null,
          blockedAt: null,
          blockedReason: null,

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

      let welcomeEmail = { sent: false, reason: "not_first_activation" };

      // ✅ só manda e-mail automático no primeiro pagamento
      if (wasAwaitingFirstPayment) {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

        const admin = await prisma.userTenant.findFirst({
          where: { tenantId, role: "admin", isActive: true },
          include: { user: true }
        });

        const to = safeStr(admin?.user?.email) || safeStr(billing?.billingEmail);

        if (to && to.includes("@")) {
          // gera token novo (evita token antigo expirado)
          const expiresAt = addDays(7);

          const token = await prisma.passwordToken.create({
            data: {
              tenantId,
              userId: admin?.user?.id || null,
              type: "invite",
              expiresAt,
              used: false
            }
          });

          const inviteUrl = buildInviteUrl(token.token);

          if (inviteUrl) {
            welcomeEmail = await sendPaymentWelcomeEmail({
              to,
              tenantName: tenant?.name,
              inviteUrl,
              expiresAt
            });
          } else {
            welcomeEmail = { sent: false, reason: "APP_WEB_URL_not_configured" };
          }
        } else {
          welcomeEmail = { sent: false, reason: "missing_admin_email" };
        }
      }

      return res.json({
        ok: true,
        action: stillTrial ? "paid_trialing" : "paid_activated",
        tenantId,
        welcomeEmail
      });
    }

    // ======================================================
    // OVERDUE => marca PAST_DUE e bloqueia após graceDays
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

        return res.json({ ok: true, action: "blocked_overdue", tenantId, daysLate, graceDays });
      }

      return res.json({ ok: true, action: "marked_past_due", tenantId, daysLate, graceDays });
    }

    // ======================================================
    // CANCELED / REFUNDED => bloqueia
    // (mantém simples: bloqueia imediatamente)
    // ======================================================
    if (event === "CANCELED" || event === "REFUNDED") {
      await prisma.tenantBilling.update({
        where: { tenantId },
        data: {
          accessStatus: "BLOCKED",
          blockedAt: now,
          blockedReason: event === "CANCELED" ? "payment_canceled" : "payment_refunded",
          lastPaymentStatus: event,
          lastPaymentId: paymentId || billing.lastPaymentId,
          lastSyncAt: now
        }
      });

      return res.json({ ok: true, action: "blocked", tenantId, event });
    }

    // outros eventos: só marca sync
    await prisma.tenantBilling.update({
      where: { tenantId },
      data: { lastSyncAt: now }
    });

    return res.json({ ok: true, action: "noop", tenantId, event: rawEvent || "UNKNOWN" });
  } catch (err) {
    logger.error({ err }, "❌ Asaas webhook error");
    return res.status(500).json({ error: "internal_error" });
  }
});

export default router;
