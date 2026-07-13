const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware, requirePlatformAdmin } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { PLANS } = require('../lib/plans');

const router = express.Router();

router.get('/overview', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    // Кабинет создателя — метрики бизнеса, а не долгов клиентов:
    // база, платящие, доход (ЮKassa + вручную внесённые платежи), активность.
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM organizations)                       AS org_count,
        (SELECT COUNT(*) FROM organizations WHERE plan <> 'free')  AS paying_org_count,
        (SELECT COUNT(*) FROM organizations
           WHERE created_at >= NOW() - INTERVAL '30 days')         AS new_orgs_30d,
        (SELECT COUNT(*) FROM users WHERE is_active = true)        AS user_count,
        (SELECT COUNT(*) FROM invoices)                            AS invoice_count,
        (SELECT COUNT(*) FROM payments)                            AS payment_count,
        (SELECT COUNT(DISTINCT o.id) FROM organizations o
           JOIN users u ON u.org_id = o.id
           WHERE u.last_login_at >= NOW() - INTERVAL '30 days')    AS active_orgs_30d,
        (SELECT COALESCE(SUM(amount_kopecks), 0) FROM billing_transactions
           WHERE status = 'succeeded')                             AS revenue_yookassa_total,
        (SELECT COALESCE(SUM(amount_kopecks), 0) FROM billing_transactions
           WHERE status = 'succeeded'
             AND confirmed_at >= date_trunc('month', NOW()))       AS revenue_yookassa_month,
        (SELECT COALESCE(SUM(amount_kopecks), 0) FROM subscription_events) AS revenue_manual_total,
        (SELECT COALESCE(SUM(amount_kopecks), 0) FROM subscription_events
           WHERE occurred_at >= date_trunc('month', NOW()))        AS revenue_manual_month
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
    const planDistribution = Object.fromEntries(planRows.rows.map(r => [r.plan, +r.c]));

    // MRR — по действующим тарифам организаций и прайсу тарифов.
    const mrrKopecks = planRows.rows.reduce((sum, r) =>
      sum + (PLANS[r.plan]?.price_kopecks || 0) * +r.c, 0);

    const revenueTotal = +t.revenue_yookassa_total + +t.revenue_manual_total;
    const revenueMonth = +t.revenue_yookassa_month + +t.revenue_manual_month;

    return ok(res, {
      organizations: +t.org_count,
      users: +t.user_count,
      invoices: +t.invoice_count,
      payments: +t.payment_count,
      paying_organizations: +t.paying_org_count,
      new_orgs_30d: +t.new_orgs_30d,
      active_orgs_30d: +t.active_orgs_30d,
      conversion_pct: +t.org_count ? Math.round((+t.paying_org_count / +t.org_count) * 100) : 0,
      active_pct: +t.org_count ? Math.round((+t.active_orgs_30d / +t.org_count) * 100) : 0,
      mrr: { kopecks: mrrKopecks, display: fmt(mrrKopecks) },
      revenue_month: { kopecks: revenueMonth, display: fmt(revenueMonth) },
      revenue_total: { kopecks: revenueTotal, display: fmt(revenueTotal) },
      plan_distribution: planDistribution,
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

router.get('/organizations/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const orgRows = await pool.query('SELECT * FROM organizations WHERE id=$1', [req.params.id]);
    if (!orgRows.rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');

    const users = await pool.query(
      `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM users WHERE org_id=$1 ORDER BY created_at`,
      [req.params.id]
    );
    const activity = await pool.query(
      `SELECT id, timestamp, action, resource, resource_id, status
       FROM audit_logs WHERE org_id=$1 ORDER BY timestamp DESC LIMIT 20`,
      [req.params.id]
    );
    const invCount = await pool.query('SELECT COUNT(*) FROM invoices WHERE org_id=$1', [req.params.id]);

    return ok(res, {
      ...orgRows.rows[0],
      invoice_count: +invCount.rows[0].count,
      users: users.rows,
      recent_activity: activity.rows,
    });
  } catch (e) {
    return dbErr(res, e, '[admin org detail]');
  }
});

router.patch('/organizations/:id', authMiddleware, requirePlatformAdmin, async (req, res) => {
  const { plan, invoice_limit, is_active, reason } = req.body || {};
  if ((plan !== undefined || invoice_limit !== undefined || is_active !== undefined) && !reason?.trim())
    return err(res, 400, 'Укажите причину изменения', 'VALIDATION_ERROR');

  try {
    const before = await pool.query('SELECT * FROM organizations WHERE id=$1', [req.params.id]);
    if (!before.rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE organizations SET
        plan = COALESCE($1, plan),
        invoice_limit = COALESCE($2, invoice_limit),
        is_active = COALESCE($3, is_active),
        updated_at = NOW()
      WHERE id = $4 RETURNING *
    `, [plan ?? null, invoice_limit ?? null, is_active ?? null, req.params.id]);

    await audit(req.params.id, req.user.id, 'admin.organization_updated', 'organization', req.params.id,
      before.rows[0], { ...rows[0], reason });

    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[admin org update]');
  }
});

router.get('/engagement', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    const totals = await pool.query('SELECT COUNT(*) AS total FROM organizations');
    const total = +totals.rows[0].total;

    const active30 = await pool.query(`
      SELECT COUNT(DISTINCT o.id) AS c FROM organizations o
      JOIN users u ON u.org_id = o.id
      WHERE u.last_login_at >= NOW() - INTERVAL '30 days'
    `);

    const activation = await pool.query(`
      SELECT COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM invoices i WHERE i.org_id = o.id AND i.created_at <= o.created_at + INTERVAL '7 days'
      )) AS activated
      FROM organizations o
    `);

    const topActive = await pool.query(`
      SELECT o.id, o.name,
        COUNT(DISTINCT i.id) FILTER (WHERE i.created_at >= NOW() - INTERVAL '30 days') AS invoices_30d,
        COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '30 days') AS payments_30d
      FROM organizations o
      LEFT JOIN invoices i ON i.org_id = o.id
      LEFT JOIN payments p ON p.org_id = o.id
      GROUP BY o.id
      ORDER BY (COUNT(DISTINCT i.id) FILTER (WHERE i.created_at >= NOW() - INTERVAL '30 days')
              + COUNT(DISTINCT p.id) FILTER (WHERE p.created_at >= NOW() - INTERVAL '30 days')) DESC
      LIMIT 10
    `);

    const dormant = await pool.query(`
      SELECT o.id, o.name, MAX(u.last_login_at) AS last_login_at
      FROM organizations o
      LEFT JOIN users u ON u.org_id = o.id
      WHERE o.is_active = true
      GROUP BY o.id
      HAVING MAX(u.last_login_at) IS NULL OR MAX(u.last_login_at) < NOW() - INTERVAL '30 days'
      ORDER BY last_login_at ASC NULLS FIRST
      LIMIT 20
    `);

    const nearLimit = await pool.query(`
      SELECT o.id, o.name, o.invoice_limit, COUNT(i.id) AS invoice_count
      FROM organizations o
      LEFT JOIN invoices i ON i.org_id = o.id
      WHERE o.invoice_limit IS NOT NULL
      GROUP BY o.id
      HAVING COUNT(i.id) >= o.invoice_limit * 0.8
      ORDER BY (COUNT(i.id)::float / NULLIF(o.invoice_limit, 0)) DESC
    `);

    return ok(res, {
      total_organizations: total,
      active_30d: +active30.rows[0].c,
      activation_rate: total ? Math.round((+activation.rows[0].activated / total) * 100) : 0,
      top_active: topActive.rows,
      dormant: dormant.rows,
      near_limit: nearLimit.rows,
    });
  } catch (e) {
    return dbErr(res, e, '[admin engagement]');
  }
});

router.get('/revenue-events', authMiddleware, requirePlatformAdmin, async (req, res) => {
  try {
    // Единая лента дохода: автоматические платежи ЮKassa + внесённые вручную.
    const { rows } = await pool.query(`
      SELECT s.id, s.org_id, s.plan::text AS plan, s.amount_kopecks, s.occurred_at, s.note,
             'manual' AS source, o.name AS org_name
      FROM subscription_events s
      JOIN organizations o ON s.org_id = o.id
      UNION ALL
      SELECT b.id, b.org_id, b.plan::text AS plan, b.amount_kopecks, b.confirmed_at::date AS occurred_at,
             NULL AS note, 'yookassa' AS source, o.name AS org_name
      FROM billing_transactions b
      JOIN organizations o ON b.org_id = o.id
      WHERE b.status = 'succeeded'
      ORDER BY occurred_at DESC
    `);
    const total = rows.reduce((sum, r) => sum + Number(r.amount_kopecks), 0);
    return ok(res, {
      items: rows.map(r => ({ ...r, amount_display: fmt(r.amount_kopecks) })),
      total_gross: { kopecks: total, display: fmt(total) },
    });
  } catch (e) {
    return dbErr(res, e, '[admin revenue list]');
  }
});

router.post('/revenue-events', authMiddleware, requirePlatformAdmin, async (req, res) => {
  const { org_id, amount_kopecks, plan, occurred_at, note } = req.body || {};
  if (!org_id) return err(res, 400, 'Укажите организацию', 'VALIDATION_ERROR');
  if (!amount_kopecks || amount_kopecks <= 0) return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');

  try {
    const { rows } = await pool.query(`
      INSERT INTO subscription_events(org_id, plan, amount_kopecks, occurred_at, note, created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *
    `, [org_id, plan || null, amount_kopecks, occurred_at || new Date().toISOString().slice(0, 10), note || null, req.user.id]);

    await audit(org_id, req.user.id, 'admin.revenue_event_created', 'subscription_event', rows[0].id, null, { amount_kopecks });
    return ok(res, rows[0], 201);
  } catch (e) {
    return dbErr(res, e, '[admin revenue create]');
  }
});

module.exports = router;
