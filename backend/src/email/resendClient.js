import fetch from "node-fetch";
import logger from "../logger.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM;

export async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    logger.warn("⚠️ RESEND_API_KEY não definido. Email não será enviado.");
    return { skipped: true };
  }
  if (!RESEND_FROM) {
    throw new Error("RESEND_FROM não definido (ex: GP Labs <no-reply@updates.gplabs.com.br>)");
  }

  const payload = {
    from: RESEND_FROM,
    to: Array.isArray(to) ? to : [to],
    subject,
    ...(html ? { html } : {}),
    ...(text ? { text } : {})
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    logger.error({ status: res.status, data }, "❌ Erro ao enviar email (Resend)");
    throw new Error(data?.message || `Falha Resend (${res.status})`);
  }

  logger.info({ to: payload.to, subject, emailId: data?.id }, "✅ Email enviado (Resend)");
  return data;
}
