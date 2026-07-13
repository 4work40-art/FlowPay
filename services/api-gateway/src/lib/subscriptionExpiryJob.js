const { pool } = require('./db');
const { audit } = require('./audit');
const { PLANS } = require('./plans');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // раз в час, срок задан днями

// Платежи ЮKassa разовые (не автосписание), поэтому окончание оплаченного
// периода обязано приводить к даунгрейду — иначе одна оплата даёт тариф
// навсегда. Лимит счетов возвращается к free.
async function runExpirySweep() {
  try {
    const { rows } = await pool.query(`
      UPDATE organizations o SET plan = 'free', invoice_limit = $1, updated_at = NOW()
      FROM subscriptions s
      WHERE s.org_id = o.id
        AND s.status = 'active' AND s.plan <> 'free'
        AND s.current_period_end IS NOT NULL AND s.current_period_end < NOW()
      RETURNING o.id, o.plan
    `, [PLANS.free.invoice_limit]);

    if (rows.length) {
      await pool.query(`
        UPDATE subscriptions SET plan='free', status='expired', updated_at=NOW()
        WHERE org_id = ANY($1) AND status = 'active'
      `, [rows.map(r => r.id)]);
      for (const row of rows) {
        await audit(row.id, null, 'billing.subscription_expired', 'organization', row.id,
          null, { plan: 'free' });
      }
      console.log(`[subscriptionExpiry] истекших подписок переведено на free: ${rows.length}`);
    }
  } catch (e) {
    console.warn('[subscriptionExpiry] sweep failed:', e.message);
  }
}

function startSubscriptionExpiryJob() {
  runExpirySweep();
  setInterval(runExpirySweep, CHECK_INTERVAL_MS);
}

module.exports = { startSubscriptionExpiryJob, runExpirySweep };
