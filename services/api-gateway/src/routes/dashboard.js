const express = require('express');
const { pool } = require('../lib/db');
const { ok, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE(SUM(amount_kopecks - paid_kopecks)
          FILTER (WHERE status NOT IN ('PAID','ARCHIVED','WRITTEN_OFF')), 0)  AS total_debt,
        COALESCE(SUM(amount_kopecks - paid_kopecks)
          FILTER (WHERE status = 'OVERDUE'), 0)                              AS overdue_debt,
        COALESCE(COUNT(*)
          FILTER (WHERE status = 'OVERDUE'), 0)                              AS overdue_count,
        COALESCE(SUM(amount_kopecks - paid_kopecks)
          FILTER (WHERE status = 'PARTIALLY_PAID'), 0)                       AS partial_debt,
        COALESCE(SUM(paid_kopecks)
          FILTER (WHERE updated_at >= DATE_TRUNC('month', NOW())), 0)        AS paid_month,
        COUNT(*) AS total_invoices
      FROM invoices WHERE org_id = $1
    `, [orgId]);

    const due7 = await pool.query(`
      SELECT COALESCE(SUM(amount_kopecks - paid_kopecks), 0) AS v, COUNT(*) AS c
      FROM invoices
      WHERE org_id = $1
        AND status IN ('UNDER_CONTROL','PAYMENT_PENDING')
        AND due_date BETWEEN NOW() AND NOW() + INTERVAL '7 days'
    `, [orgId]);

    // Trust Score — не статичное число, а доля собственных счетов организации,
    // оплаченных без просрочки/списания/спора. Пока нет истории — 100 (нейтральный старт),
    // не 50: у только что зарегистрированной организации нет причин выглядеть "подозрительно".
    const trustRows = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PAID') AS good,
        COUNT(*) FILTER (WHERE status IN ('OVERDUE', 'WRITTEN_OFF', 'DISPUTED')) AS bad
      FROM invoices WHERE org_id = $1
    `, [orgId]);
    const good = +trustRows.rows[0].good, bad = +trustRows.rows[0].bad;
    const trustScore = (good + bad) > 0 ? Math.round((good / (good + bad)) * 100) : 100;

    const s = rows[0];
    return ok(res, {
      total_debt:      { kopecks: +s.total_debt,   display: fmt(s.total_debt) },
      overdue_debt:    { kopecks: +s.overdue_debt,  display: fmt(s.overdue_debt), count: +s.overdue_count },
      partial_debt:    { kopecks: +s.partial_debt,  display: fmt(s.partial_debt) },
      paid_this_month: { kopecks: +s.paid_month,    display: fmt(s.paid_month) },
      due_7_days:      { kopecks: +due7.rows[0].v,  display: fmt(due7.rows[0].v), count: +due7.rows[0].c },
      total_invoices:  +s.total_invoices,
      trust_score:     trustScore,
    });
  } catch (e) {
    return dbErr(res, e, '[dashboard]');
  }
});

module.exports = router;
