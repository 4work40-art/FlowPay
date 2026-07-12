// Нет отдельного Notification Module — это минимально нужная для UX-2
// прослойка отправки писем. Без SMTP_* в env письмо не уходит, ссылка на
// сброс пароля просто пишется в лог — эксплуатационный костыль до появления
// полноценного Notification Module (см. ROADMAP.md).
let transporter = null;

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (transporter) return transporter;
  const nodemailer = require('nodemailer');
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendMail({ to, subject, text }) {
  if (!isConfigured()) {
    console.warn(`[mailer] SMTP не настроен — письмо для ${to} не отправлено. Содержимое:\n${text}`);
    return { delivered: false };
  }
  await getTransporter().sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, subject, text,
  });
  return { delivered: true };
}

module.exports = { isConfigured, sendMail };
