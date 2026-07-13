const { pool } = require('./db');
const mailer = require('./mailer');
const { fmt } = require('./http');

// Ежедневный email-дайджест просрочки владельцу организации.
// Канал — только email (SMS/Telegram исключены решением владельца продукта).
// Письмо уходит один раз в сутки на организацию и только если есть просрочка.
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // проверяем раз в час, шлём раз в сутки
const SEND_HOUR_UTC = Number(process.env.DIGEST_HOUR_UTC || 6); // 06:00 UTC = 09:00 МСК

let lastSentDate = null; // YYYY-MM-DD последней рассылки (в памяти процесса)

async function runDigestSweep(force = false) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (!force) {
    if (now.getUTCHours() !== SEND_HOUR_UTC) return;
    if (lastSentDate === today) return;
  }
  if (!mailer.isConfigured()) return; // без SMTP дайджест просто не работает

  try {
    const { rows } = await pool.query(`
      SELECT o.id AS org_id, u.email,
        COUNT(i.id) AS overdue_count,
        SUM(i.amount_kopecks - i.paid_kopecks) AS overdue_kopecks,
        STRING_AGG('№' || COALESCE(i.number, LEFT(i.id::text, 8)) || ' — ' ||
          ROUND((i.amount_kopecks - i.paid_kopecks) / 100.0, 2) || ' ₽',
          E'\n' ORDER BY i.due_date) AS lines
      FROM organizations o
      JOIN users u ON u.org_id = o.id AND u.role = 'owner' AND u.is_active = true
      JOIN invoices i ON i.org_id = o.id AND i.status = 'OVERDUE'
      WHERE o.is_active = true
      GROUP BY o.id, u.email
    `);

    for (const r of rows) {
      try {
        await mailer.sendMail({
          to: r.email,
          subject: `Просроченные счета: ${r.overdue_count} на ${fmt(r.overdue_kopecks)} — Счёт&Контроль`,
          text: `Доброе утро!\n\nПо вашей организации просрочено счетов: ${r.overdue_count}, всего ${fmt(r.overdue_kopecks)}.\n\n${r.lines}\n\nПодробности — в разделе «Счета»: ${process.env.APP_BASE_URL || 'http://localhost:3000'}/invoices?status=OVERDUE\n\nЧтобы перестать получать дайджест, напишите в поддержку.`,
        });
      } catch (e) {
        console.warn(`[overdueDigest] письмо для ${r.email} не ушло:`, e.message);
      }
    }
    lastSentDate = today;
    if (rows.length) console.log(`[overdueDigest] отправлено дайджестов: ${rows.length}`);
  } catch (e) {
    console.warn('[overdueDigest] sweep failed:', e.message);
  }
}

function startOverdueDigestJob() {
  setInterval(runDigestSweep, CHECK_INTERVAL_MS);
}

module.exports = { startOverdueDigestJob, runDigestSweep };
