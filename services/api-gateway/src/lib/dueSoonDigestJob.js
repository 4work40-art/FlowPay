const { pool } = require('./db');
const mailer = require('./mailer');
const { fmt } = require('./http');

// Проактивное напоминание О ПЛАТЕЖЕ до наступления срока оплаты — в отличие
// от overdueDigestJob.js (который сообщает о том, что УЖЕ просрочено), этот
// джоб предупреждает заранее, за N дней до due_date. N настраивается на
// уровне организации (organizations.reminder_days_before), а не глобально —
// разным организациям удобны разные сроки. Канал — только email.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const SEND_HOUR_UTC = Number(process.env.DIGEST_HOUR_UTC || 6);

let lastSentDate = null;

async function runDueSoonSweep(force = false) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (!force) {
    if (now.getUTCHours() !== SEND_HOUR_UTC) return;
    if (lastSentDate === today) return;
  }
  if (!mailer.isConfigured()) return;

  try {
    // due_date ровно через reminder_days_before дней от сегодня — каждый
    // счёт напоминается один раз (в свой день N), а не каждый день до срока.
    const { rows } = await pool.query(`
      SELECT o.id AS org_id, u.email, o.reminder_days_before,
        COUNT(i.id) AS due_count,
        SUM(i.amount_kopecks - i.paid_kopecks) AS due_kopecks,
        STRING_AGG('№' || COALESCE(i.number, LEFT(i.id::text, 8)) || ' — ' ||
          ROUND((i.amount_kopecks - i.paid_kopecks) / 100.0, 2) || ' ₽ (срок ' ||
          TO_CHAR(i.due_date, 'DD.MM.YYYY') || ')',
          E'\n' ORDER BY i.due_date) AS lines
      FROM organizations o
      JOIN users u ON u.org_id = o.id AND u.role = 'owner' AND u.is_active = true
      JOIN invoices i ON i.org_id = o.id
        AND i.status IN ('UNDER_CONTROL','PAYMENT_PENDING','PARTIALLY_PAID')
        AND i.due_date = CURRENT_DATE + (o.reminder_days_before || ' days')::interval
      WHERE o.is_active = true
      GROUP BY o.id, u.email, o.reminder_days_before
    `);

    for (const r of rows) {
      try {
        await mailer.sendMail({
          to: r.email,
          subject: `Скоро срок оплаты: ${r.due_count} счетов на ${fmt(r.due_kopecks)} — Счёт&Контроль`,
          text: `Доброе утро!\n\nЧерез ${r.reminder_days_before} дн. наступает срок оплаты по ${r.due_count} счетам, всего ${fmt(r.due_kopecks)}.\n\n${r.lines}\n\nПодробности — в разделе «Календарь»: ${process.env.APP_BASE_URL || 'http://localhost:3000'}/calendar\n\nСрок напоминания можно изменить в настройках организации.`,
        });
      } catch (e) {
        console.warn(`[dueSoonDigest] письмо для ${r.email} не ушло:`, e.message);
      }
    }
    lastSentDate = today;
    if (rows.length) console.log(`[dueSoonDigest] отправлено напоминаний: ${rows.length}`);
  } catch (e) {
    console.warn('[dueSoonDigest] sweep failed:', e.message);
  }
}

function startDueSoonDigestJob() {
  setInterval(runDueSoonSweep, CHECK_INTERVAL_MS);
}

module.exports = { startDueSoonDigestJob, runDueSoonSweep };
