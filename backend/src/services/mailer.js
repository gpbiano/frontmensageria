// backend/src/services/mailer.js
import logger from "../logger.js";

// ✅ Se você já tem um serviço real, substitui aqui dentro.
// Ex.: nodemailer, resend, sendgrid, etc.
export async function sendInviteEmail({ to, name, inviteLink, expiresAt }) {
  // Se você quiser ativar SMTP depois, eu conecto em 2 minutos.
  // Por enquanto: deixa rastreável no log.
  logger.info(
    { to, name, inviteLink, expiresAt },
    "WELCOME_INVITE_EMAIL (stub): enviar link de criação de senha"
  );

  // Se tiver provider real, dispara aqui e retorna.
  return true;
}
