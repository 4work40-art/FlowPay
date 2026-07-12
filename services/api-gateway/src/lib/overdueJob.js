const { pool } = require('./db');
const { audit } = require('./audit');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // раз в час — достаточно для срока в днях

async function runOverdueSweep() {
  try {
    const { rows } = await pool.query(`
      UPDATE invoices SET status = 'OVERDUE', updated_at = NOW(), version = version + 1
      WHERE status IN ('UNDER_CONTROL', 'PAYMENT_PENDING')
        AND due_date IS NOT NULL AND due_date < CURRENT_DATE
      RETURNING id, org_id, created_by
    `);
    for (const row of rows) {
      await audit(row.org_id, row.created_by, 'invoice.auto_overdue', 'invoice', row.id, null, { status: 'OVERDUE' });
    }
    if (rows.length) console.log(`[overdueJob] переведено в OVERDUE: ${rows.length}`);
  } catch (e) {
    console.warn('[overdueJob] sweep failed:', e.message);
  }
}

function startOverdueJob() {
  runOverdueSweep();
  setInterval(runOverdueSweep, CHECK_INTERVAL_MS);
}

module.exports = { startOverdueJob, runOverdueSweep };
