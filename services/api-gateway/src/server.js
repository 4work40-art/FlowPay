const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Pool }   = require('pg');
const Redis      = require('ioredis');

// ─── App ─────────────────────────────────────────────────
const app  = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── DB ──────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL ||
    'postgresql://sk_user:sk_secret_local@localhost:5432/schyot_kontrol',
});

pool.on('error', (e) => console.warn('[PG error]', e.message));

// ─── Redis (token revocation) ─────────────────────────────
const redis = new Redis(
  process.env.REDIS_URL || 'redis://:sk_redis_local@localhost:6379',
  { lazyConnect: true, maxRetriesPerRequest: 2 }
);
redis.on('error', (e) => console.warn('[Redis error]', e.message));
redis.connect().catch((e) => console.warn('[Redis connect]', e.message));

// ─── Auth helpers ──────────────────────────────────────────
const JWT_SECRET  = process.env.JWT_SECRET || 'local_dev_secret_key_32chars_min';
const TOKEN_TTL_S = 86400; // 24h

function signToken(user) {
  const jti = randomUUID();
  const token = jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role, email: user.email,
      admin: !!user.is_platform_admin, jti },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_S }
  );
  return { token, jti };
}

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return err(res, 401, 'Missing bearer token', 'UNAUTHORIZED');

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return err(res, 401, 'Invalid or expired token', 'UNAUTHORIZED');
  }

  try {
    const revoked = await redis.get(`revoked:${payload.jti}`);
    if (revoked) return err(res, 401, 'Token has been revoked', 'UNAUTHORIZED');
  } catch (e) {
    console.warn('[auth] revocation check skipped:', e.message);
  }

  req.user = {
    id: payload.sub, org_id: payload.org, role: payload.role, email: payload.email,
    is_platform_admin: !!payload.admin, jti: payload.jti,
  };
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) return err(res, 403, 'Platform admin access required', 'FORBIDDEN');
  next();
}

function fmt(kopecks) {
  const n = Math.round(Number(kopecks || 0)) / 100;
  return n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ₽';
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}

function err(res, status, message, code) {
  return res.status(status).json({ success: false, error: { code, message } });
}

async function audit(orgId, userId, action, resource, resourceId, before, after) {
  try {
    await pool.query(
      `INSERT INTO audit_logs(org_id,user_id,action,resource,resource_id,before_state,after_state,status)
       VALUES($1,$2,$3,$4,$5,$6,$7,'success')`,
      [orgId, userId, action, resource, resourceId || null,
       before ? JSON.stringify(before) : null,
       after  ? JSON.stringify(after)  : null]
    );
  } catch (e) {
    console.warn('[audit]', e.message);
  }
}

// ─── Health ──────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let db = 'ok';
  try { await pool.query('SELECT 1'); } catch { db = 'error'; }
  res.json({ status: db === 'ok' ? 'ok' : 'degraded', db, ts: new Date().toISOString() });
});

// ─── Auth ─────────────────────────────────────────────────
app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return err(res, 400, 'Email and password required', 'VALIDATION_ERROR');

  try {
    // Используем pgcrypto для проверки пароля — без bcrypt npm модуля
    const { rows } = await pool.query(
      `SELECT u.*, o.name AS org_name, o.plan
       FROM users u
       LEFT JOIN organizations o ON u.org_id = o.id
       WHERE u.email = $1 AND u.is_active = true
         AND u.password_hash = crypt($2, u.password_hash)`,
      [email.toLowerCase().trim(), password]
    );

    if (!rows.length)
      return err(res, 401, 'Invalid email or password', 'UNAUTHORIZED');

    const u = rows[0];
    const { token, jti } = signToken(u);

    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [u.id]);
    await audit(u.org_id, u.id, 'auth.login', 'user', u.id, null, { email: u.email });

    return ok(res, {
      access_token: token,
      refresh_token: token,
      expires_in: TOKEN_TTL_S,
      user: {
        id: u.id, email: u.email, name: u.name, role: u.role,
        org_id: u.org_id, org_name: u.org_name, plan: u.plan,
        trust_score: u.trust_score, is_platform_admin: !!u.is_platform_admin
      }
    });
  } catch (e) {
    console.error('[login]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.post('/api/v1/auth/logout', authMiddleware, async (req, res) => {
  try {
    await redis.set(`revoked:${req.user.jti}`, '1', 'EX', TOKEN_TTL_S);
  } catch (e) {
    console.warn('[logout] revoke failed:', e.message);
  }
  return ok(res, { message: 'Logged out' });
});

// ─── Dashboard ───────────────────────────────────────────
app.get('/api/v1/dashboard', authMiddleware, async (req, res) => {
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

    const uRows = await pool.query(
      `SELECT trust_score FROM users WHERE org_id = $1 AND role = 'owner' LIMIT 1`, [orgId]
    );

    const s = rows[0];
    return ok(res, {
      total_debt:      { kopecks: +s.total_debt,   display: fmt(s.total_debt) },
      overdue_debt:    { kopecks: +s.overdue_debt,  display: fmt(s.overdue_debt), count: +s.overdue_count },
      partial_debt:    { kopecks: +s.partial_debt,  display: fmt(s.partial_debt) },
      paid_this_month: { kopecks: +s.paid_month,    display: fmt(s.paid_month) },
      due_7_days:      { kopecks: +due7.rows[0].v,  display: fmt(due7.rows[0].v), count: +due7.rows[0].c },
      total_invoices:  +s.total_invoices,
      trust_score:     uRows.rows[0]?.trust_score || 50,
    });
  } catch (e) {
    console.error('[dashboard]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Invoices ────────────────────────────────────────────
app.get('/api/v1/invoices', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const status = req.query.status;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  try {
    const params = [orgId];
    let where = 'WHERE i.org_id = $1';
    if (status) { params.push(status.toUpperCase()); where += ` AND i.status = $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const cnt = await pool.query(`SELECT COUNT(*) FROM invoices i ${where}`, params);

    return ok(res, {
      items: rows.map(r => ({
        ...r,
        amount_display:    fmt(r.amount_kopecks),
        paid_display:      fmt(r.paid_kopecks),
        remaining_display: fmt(r.remaining_kopecks),
      })),
      total: +cnt.rows[0].count, page, limit,
    });
  } catch (e) {
    console.error('[invoices list]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.get('/api/v1/invoices/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Invoice not found', 'NOT_FOUND');

    const pmts = await pool.query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    const inv = rows[0];
    return ok(res, {
      ...inv,
      amount_display:    fmt(inv.amount_kopecks),
      paid_display:      fmt(inv.paid_kopecks),
      remaining_display: fmt(inv.remaining_kopecks),
      payments: pmts.rows.map(p => ({ ...p, amount_display: fmt(p.amount_kopecks) })),
    });
  } catch (e) {
    console.error('[invoice get]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.post('/api/v1/invoices', authMiddleware, async (req, res) => {
  const { amount_kopecks, number, counterparty_id, due_date, notes } = req.body || {};
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'amount_kopecks must be > 0', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'amount_kopecks must be integer (kopecks)', 'VALIDATION_ERROR');

  try {
    const orgId = req.user.org_id;
    const { rows } = await pool.query(`
      INSERT INTO invoices(org_id, counterparty_id, number, amount_kopecks, due_date, notes, status, created_by)
      VALUES($1,$2,$3,$4,$5,$6,'CREATED',$7) RETURNING *
    `, [orgId, counterparty_id || null, number || null, amount_kopecks, due_date || null, notes || null, req.user.id]);

    await audit(orgId, req.user.id, 'invoice.created', 'invoice', rows[0].id, null, { amount_kopecks, status: 'CREATED' });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks) }, 201);
  } catch (e) {
    console.error('[invoice create]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.patch('/api/v1/invoices/:id/state', authMiddleware, async (req, res) => {
  const { transition, reason } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Invoice not found', 'NOT_FOUND');
    const inv = rows[0];

    const TRANSITIONS = {
      mark_for_control: { from: ['CREATED'],                                  to: 'UNDER_CONTROL'   },
      set_pending:      { from: ['UNDER_CONTROL'],                             to: 'PAYMENT_PENDING' },
      open_dispute:     { from: ['PAYMENT_PENDING','OVERDUE','PARTIALLY_PAID'],to: 'DISPUTED'        },
      archive:          { from: ['PAID'],                                      to: 'ARCHIVED'        },
      write_off:        { from: ['OVERDUE'],                                   to: 'WRITTEN_OFF'     },
      mark_overdue:     { from: ['PAYMENT_PENDING','UNDER_CONTROL'],           to: 'OVERDUE'         },
    };

    const t = TRANSITIONS[transition];
    if (!t) return err(res, 400, `Unknown transition: ${transition}`, 'INVOICE_STATE_INVALID');
    if (!t.from.includes(inv.status))
      return err(res, 400, `Transition ${transition} not allowed from ${inv.status}`, 'INVOICE_STATE_INVALID');

    await pool.query('UPDATE invoices SET status=$1, updated_at=NOW(), version=version+1 WHERE id=$2', [t.to, req.params.id]);
    await audit(inv.org_id, req.user.id, 'invoice.state_changed', 'invoice', req.params.id,
      { status: inv.status }, { status: t.to, reason });

    return ok(res, { id: req.params.id, previous_state: inv.status, new_state: t.to, transitioned_at: new Date().toISOString() });
  } catch (e) {
    console.error('[invoice state]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Payments ────────────────────────────────────────────
app.get('/api/v1/payments', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT p.*, i.number AS invoice_number, c.name AS counterparty_name
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      WHERE p.org_id = $1 ORDER BY p.created_at DESC LIMIT 50
    `, [orgId]);
    return ok(res, { items: rows.map(r => ({ ...r, amount_display: fmt(r.amount_kopecks) })) });
  } catch (e) {
    console.error('[payments list]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.post('/api/v1/payments', authMiddleware, async (req, res) => {
  const { invoice_id, amount_kopecks, method, reference, payment_date } = req.body || {};
  if (!invoice_id)      return err(res, 400, 'invoice_id required', 'VALIDATION_ERROR');
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'amount_kopecks must be > 0', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'amount_kopecks must be integer', 'VALIDATION_ERROR');

  try {
    const invRows = await pool.query('SELECT * FROM invoices WHERE id=$1', [invoice_id]);
    if (!invRows.rows.length || invRows.rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Invoice not found', 'NOT_FOUND');
    const inv = invRows.rows[0];

    const remaining = inv.amount_kopecks - inv.paid_kopecks;
    if (amount_kopecks > remaining)
      return err(res, 400, `Amount exceeds remaining balance. Max: ${remaining} kopecks`, 'PAYMENT_VALIDATION_ERROR');

    const { rows } = await pool.query(`
      INSERT INTO payments(invoice_id, org_id, amount_kopecks, method, reference, payment_date, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [invoice_id, inv.org_id, amount_kopecks,
        method || 'bank_transfer', reference || null,
        payment_date || new Date().toISOString().slice(0,10), req.user.id]);

    const newPaid   = inv.paid_kopecks + amount_kopecks;
    const newStatus = newPaid >= inv.amount_kopecks ? 'PAID' : 'PARTIALLY_PAID';

    await pool.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [newPaid, newStatus, invoice_id]);

    await audit(inv.org_id, req.user.id, 'payment.created', 'payment', rows[0].id,
      { paid_kopecks: inv.paid_kopecks, status: inv.status },
      { paid_kopecks: newPaid, status: newStatus });

    return ok(res, {
      payment_id:        rows[0].id,
      invoice_id,
      amount_display:    fmt(amount_kopecks),
      remaining_display: fmt(inv.amount_kopecks - newPaid),
      invoice_status:    newStatus,
      status:            'confirmed',
    }, 201);
  } catch (e) {
    console.error('[payment create]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Counterparties ───────────────────────────────────────
app.get('/api/v1/counterparties', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks)
          FILTER (WHERE i.status NOT IN ('PAID','ARCHIVED')), 0) AS debt_kopecks
      FROM counterparties c
      LEFT JOIN invoices i ON i.counterparty_id = c.id
      WHERE c.org_id = $1 AND c.is_active = true
      GROUP BY c.id ORDER BY c.name
    `, [orgId]);
    return ok(res, { items: rows.map(r => ({ ...r, debt_display: fmt(r.debt_kopecks) })) });
  } catch (e) {
    console.error('[counterparties]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Users ───────────────────────────────────────────────
app.get('/api/v1/users/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, o.name AS org_name, o.plan
       FROM users u
       LEFT JOIN organizations o ON u.org_id = o.id
       WHERE u.id = $1`, [req.user.id]
    );
    if (!rows.length) return err(res, 404, 'User not found', 'NOT_FOUND');
    const u = rows[0];
    const perms = {
      owner:       ['invoices:*','payments:*','org:admin','audit:read'],
      accountant:  ['invoices:read','invoices:write','payments:read','payments:write'],
      vendor_admin:['invoices:read','payments:read','audit:read','vendor:admin'],
      readonly:    ['invoices:read','payments:read'],
    };
    return ok(res, {
      id: u.id, email: u.email, name: u.name, role: u.role,
      org_id: u.org_id, org_name: u.org_name, plan: u.plan,
      trust_score: u.trust_score,
      permissions: perms[u.role] || [],
    });
  } catch (e) {
    console.error('[users/me]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Audit ───────────────────────────────────────────────
app.get('/api/v1/audit/logs', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const action = req.query.action;
  const limit  = Math.min(100, parseInt(req.query.limit) || 30);

  try {
    const params = [orgId];
    let where = 'WHERE org_id = $1';
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return ok(res, { items: rows, total: rows.length });
  } catch (e) {
    console.error('[audit]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── Platform admin (кабинет создателя) ───────────────────
app.get('/api/v1/admin/overview', authMiddleware, requirePlatformAdmin, async (req, res) => {
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
    console.error('[admin overview]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

app.get('/api/v1/admin/organizations', authMiddleware, requirePlatformAdmin, async (req, res) => {
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
    console.error('[admin organizations]', e.message);
    return err(res, 500, e.message, 'SERVER_ERROR');
  }
});

// ─── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
});

// ─── Start ───────────────────────────────────────────────
async function start() {
  // Wait for DB to be ready
  let retries = 10;
  while (retries > 0) {
    try {
      await pool.query('SELECT 1');
      console.log('[DB] Connected to PostgreSQL');
      break;
    } catch (e) {
      retries--;
      console.log(`[DB] Waiting for PostgreSQL... (${retries} retries left)`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }

  app.listen(port, () => {
    console.log('\n========================================');
    console.log(`  API Gateway: http://localhost:${port}`);
    console.log(`  Health:      http://localhost:${port}/health`);
    console.log(`  Dashboard:   http://localhost:${port}/api/v1/dashboard`);
    console.log('========================================\n');
  });
}

start().catch(console.error);
