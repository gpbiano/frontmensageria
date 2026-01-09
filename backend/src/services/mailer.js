// backend/src/services/mailer.js
import logger from "../logger.js";

function safeStr(v) {
  return String(v || "").trim();
}

export async function sendEmailResend({ to, subject, html }) {
  const RESEND_API_KEY = safeStr(process.env.RESEND_API_KEY);
  const FROM = safeStr(process.env.RESEND_FROM || process.env.MAIL_FROM || "");

  if (!RESEND_API_KEY || !FROM) {
    logger.warn(
      { hasKey: Boolean(RESEND_API_KEY), hasFrom: Boolean(FROM) },
      "resend: não configurado (pulando envio)"
    );
    return { sent: false, reason: "resend_not_configured" };
  }

  let ResendCtor;
  try {
    // SDK oficial
    // npm i resend
    const mod = await import("resend");
    ResendCtor = mod?.Resend;
  } catch (err) {
    logger.warn({ err }, "resend: pacote não disponível (pulando envio)");
    return { sent: false, reason: "resend_pkg_missing" };
  }

  try {
    const resend = new ResendCtor(RESEND_API_KEY);
    await resend.emails.send({
      from: FROM,
      to,
      subject,
      html
    });

    return { sent: true };
  } catch (err) {
    logger.error({ err }, "resend: falha ao enviar");
    return { sent: false, reason: "send_failed" };
  }
}
