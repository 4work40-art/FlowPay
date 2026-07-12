const express = require('express');
const { pool } = require('../lib/db');
const { ok, dbErr, fmt } = require('../lib/http');
const { authMiddleware, requirePlatformAdmin } = require('../lib/auth');

const router = express.Router();

router.get('/overview', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM organizations)                AS org_count,
        (SELECT COUNT(*) FROM users WHERE is_active = true)  AS user_count,
        (SELECT COUNT(*) FROM invoices)                      AS invoice_count,
        (SELECT COUNT(*) FROM payments)                      AS payment_count,
        (SELECT COALESCE(SUM(amount_kopecks - paid_kopecks) FILTER
           (WHERE status NOT IN ('PAID','ARCHIVED','WRITTEN_OFF')), 0) FROM invoices) AS total_debt
    `);

    const planRows = await pool.query(
      `SELECT plan, COUNT(*) AS c FROM organizations GROUP BY plan`
    );

    const weekRows = await pool.query(`
      SELECT date_trunc('week', created_at) AS week, COUNT(*) AS c
      FROM organizations
      WHERE created_at >= NOW() - INTERVAL '12 weeks'
      GROUP BY week
    `);
    const byWeek = new Map(weekRows.rows.map(r => [new Date(r.week).toISOString().slice(0, 10), +r.c]));
    const growth = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay() - i * 7 + 1); // понедельник соответствующей недели
      const key = d.toISOString().slice(0, 10);
      growth.push({ week: key, organizations: byWeek.get(key) || 0 });
    }

    const activity = await pool.query(`
      SELECT a.id, a.timestamp, a.action, a.resource, a.resource_id, a.status,
             o.name AS org_name
      FROM audit_logs a
      LEFT JOIN organizations o ON a.org_id = o.id
      ORDER BY a.timestamp DESC LIMIT 20
    `);

    const t = totals.rows[0];
    return ok(res, {
      organizations: +t.org_count,
      users: +t.user_count,
      invoices: +t.invoice_count,
      payments: +t.payment_count,
      total_debt: { kopecks: +t.total_debt, display: fmt(t.total_debt) },
      plan_distribution: Object.fromEntries(planRows.rows.map(r => [r.plan, +r.c])),
      growth,
      recent_activity: activity.rows,
    });
  } catch (e) {
    return dbErr(res, e, '[admin overview]');
  }
});

router.get('/organizations', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.id, o.name, o.plan, o.invoice_limit, o.is_active, o.created_at,
        COUNT(DISTINCT u.id) AS user_count,
        COUNT(DISTINCT i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks) FILTER
          (WHERE i.status NOT IN ('PAID','ARCHIVED','WRITTEN_OFF')), 0) AS debt_kopecks
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id
      LEFT JOIN invoices i ON i.org_id = o.id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    return ok(res, {
      items: rows.map(r => ({ ...r, debt_display: fmt(r.debt_kopecks) })),
      total: rows.length,
    });
  } catch (e) {
    return dbErr(res, e, '[admin organizations]');
  }
});

module.exports = router;
