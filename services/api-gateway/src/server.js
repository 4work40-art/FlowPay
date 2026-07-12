const express    = require('express');
const cors       = require('cors');
const jwt        = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { Pool }   = require('pg');
const Redis      = require('ioredis');

// ─── App ─────────────────────────────────────────────────
const app  = express();
const port = process.env.PORT || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
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
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET env var is required (>=32 chars) — refusing to start with a weak/missing secret.');
  process.exit(1);
}
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
  if (!token) return err(res, 401, 'Токен доступа отсутствует', 'UNAUTHORIZED');

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return err(res, 401, 'Токен недействителен или истёк', 'UNAUTHORIZED');
  }

  try {
    const revoked = await redis.get(`revoked:${payload.jti}`);
    if (revoked) return err(res, 401, 'Токен отозван', 'UNAUTHORIZED');
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
  if (!req.user?.is_platform_admin) return err(res, 403, 'Требуются права администратора платформы', 'FORBIDDEN');
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

// Сырые ошибки Postgres не должны улетать клиенту как есть — известные
// коды валидации превращаем в понятный 400, остальное прячем за 500.
const DB_VALIDATION_MESSAGES = {
  '22007': 'Некорректная дата/время',
  '22008': 'Дата/время вне допустимого диапазона',
  '22P02': 'Некорректный формат данных',
  '23502': 'Не заполнено обязательное поле',
  '23503': 'Связанная запись не найдена',
  '23514': 'Значение нарушает ограничение',
};
function dbErr(res, e, tag) {
  console.error(tag, e.message);
  const msg = DB_VALIDATION_MESSAGES[e.code];
  if (msg) return err(res, 400, msg, 'VALIDATION_ERROR');
  return err(res, 500, 'Внутренняя ошибка сервера', 'SERVER_ERROR');
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
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

app.post('/api/v1/auth/register', async (req, res) => {
  const { org_name, email, password, name } = req.body || {};
  if (!org_name || !org_name.trim())
    return err(res, 400, 'Укажите название организации', 'VALIDATION_ERROR');
  if (!email || !EMAIL_RE.test(email))
    return err(res, 400, 'Укажите корректный email', 'VALIDATION_ERROR');
  if (!password || password.length < 8)
    return err(res, 400, 'Пароль должен содержать не менее 8 символов', 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase().trim()]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return err(res, 409, 'Пользователь с таким email уже зарегистрирован', 'ALREADY_EXISTS');
    }

    const orgRows = await client.query(
      `INSERT INTO organizations(name, plan, invoice_limit) VALUES($1,'free',5) RETURNING *`,
      [org_name.trim()]
    );
    const org = orgRows.rows[0];

    const userRows = await client.query(`
      INSERT INTO users(email, password_hash, name, role, org_id)
      VALUES($1, crypt($2, gen_salt('bf')), $3, 'owner', $4) RETURNING *
    `, [email.toLowerCase().trim(), password, (name || '').trim() || null, org.id]);
    const u = userRows.rows[0];

    await client.query('COMMIT');
    await audit(org.id, u.id, 'org.registered', 'organization', org.id, null, { org_name: org.name, email: u.email });

    const { token } = signToken(u);
    return ok(res, {
      access_token: token,
      refresh_token: token,
      expires_in: TOKEN_TTL_S,
      user: {
        id: u.id, email: u.email, name: u.name, role: u.role,
        org_id: org.id, org_name: org.name, plan: org.plan,
        trust_score: u.trust_score, is_platform_admin: false,
      }
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[register]');
  } finally {
    client.release();
  }
});

app.post('/api/v1/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return err(res, 400, 'Укажите email и пароль', 'VALIDATION_ERROR');

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
      return err(res, 401, 'Неверный email или пароль', 'UNAUTHORIZED');

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
    return dbErr(res, e, '[login]');
  }
});

app.post('/api/v1/auth/logout', authMiddleware, async (req, res) => {
  try {
    await redis.set(`revoked:${req.user.jti}`, '1', 'EX', TOKEN_TTL_S);
  } catch (e) {
    console.warn('[logout] revoke failed:', e.message);
  }
  return ok(res, { message: 'Вы вышли из системы' });
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
    return dbErr(res, e, '[dashboard]');
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
    return dbErr(res, e, '[invoices list]');
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
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');

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
    return dbErr(res, e, '[invoice get]');
  }
});

app.post('/api/v1/invoices', authMiddleware, async (req, res) => {
  const { amount_kopecks, number, counterparty_id, due_date, notes } = req.body || {};
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'Сумма должна быть целым числом (в копейках)', 'VALIDATION_ERROR');

  try {
    const orgId = req.user.org_id;

    const orgRows = await pool.query('SELECT invoice_limit FROM organizations WHERE id=$1', [orgId]);
    const limit = orgRows.rows[0]?.invoice_limit;
    if (limit != null) {
      const cnt = await pool.query('SELECT COUNT(*) FROM invoices WHERE org_id=$1', [orgId]);
      if (+cnt.rows[0].count >= limit)
        return err(res, 403, `Достигнут лимит счетов на вашем тарифе (${limit}). Обновите тариф, чтобы продолжить.`, 'PLAN_LIMIT_REACHED');
    }

    if (counterparty_id) {
      const cp = await pool.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [counterparty_id, orgId]);
      if (!cp.rows.length)
        return err(res, 400, 'Контрагент не найден в вашей организации', 'VALIDATION_ERROR');
    }

    const { rows } = await pool.query(`
      INSERT INTO invoices(org_id, counterparty_id, number, amount_kopecks, due_date, notes, status, created_by)
      VALUES($1,$2,$3,$4,$5,$6,'CREATED',$7) RETURNING *
    `, [orgId, counterparty_id || null, number || null, amount_kopecks, due_date || null, notes || null, req.user.id]);

    await audit(orgId, req.user.id, 'invoice.created', 'invoice', rows[0].id, null, { amount_kopecks, status: 'CREATED' });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks) }, 201);
  } catch (e) {
    return dbErr(res, e, '[invoice create]');
  }
});

app.patch('/api/v1/invoices/:id/state', authMiddleware, async (req, res) => {
  const { transition, reason } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    const inv = rows[0];

    const TRANSITIONS = {
      mark_for_control: { from: ['CREATED'],                                  to: 'UNDER_CONTROL'   },
      set_pending:      { from: ['UNDER_CONTROL'],                             to: 'PAYMENT_PENDING' },
      open_dispute:     { from: ['PAYMENT_PENDING','OVERDUE','PARTIALLY_PAID'],to: 'DISPUTED'        },
      archive:          { from: ['PAID'],                                      to: 'ARCHIVED'        },
      write_off:        { from: ['OVERDUE'],                                   to: 'WRITTEN_OFF'     },
      mark_overdue:     { from: ['PAYMENT_PENDING','UNDER_CONTROL'],           to: 'OVERDUE'         },
      resolve_dispute:  { from: ['DISPUTED'],                                  to: 'UNDER_CONTROL'   },
    };

    const t = TRANSITIONS[transition];
    if (!t) return err(res, 400, `Неизвестный переход статуса: ${transition}`, 'INVOICE_STATE_INVALID');
    if (!t.from.includes(inv.status))
      return err(res, 400, `Переход «${transition}» недопустим из статуса ${inv.status}`, 'INVOICE_STATE_INVALID');

    await pool.query('UPDATE invoices SET status=$1, updated_at=NOW(), version=version+1 WHERE id=$2', [t.to, req.params.id]);
    await audit(inv.org_id, req.user.id, 'invoice.state_changed', 'invoice', req.params.id,
      { status: inv.status }, { status: t.to, reason });

    return ok(res, { id: req.params.id, previous_state: inv.status, new_state: t.to, transitioned_at: new Date().toISOString() });
  } catch (e) {
    return dbErr(res, e, '[invoice state]');
  }
});

// ─── Payments ────────────────────────────────────────────
app.get('/api/v1/payments', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  try {
    const { rows } = await pool.query(`
      SELECT p.*, i.number AS invoice_number, c.name AS counterparty_name
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      WHERE p.org_id = $1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3
    `, [orgId, limit, offset]);
    const cnt = await pool.query('SELECT COUNT(*) FROM payments WHERE org_id = $1', [orgId]);
    return ok(res, {
      items: rows.map(r => ({ ...r, amount_display: fmt(r.amount_kopecks) })),
      total: +cnt.rows[0].count, page, limit,
    });
  } catch (e) {
    return dbErr(res, e, '[payments list]');
  }
});

const PAYMENT_BLOCKED_STATUSES = ['DISPUTED', 'ARCHIVED', 'WRITTEN_OFF'];

app.post('/api/v1/payments', authMiddleware, async (req, res) => {
  const { invoice_id, amount_kopecks, method, reference, payment_date } = req.body || {};
  if (!invoice_id)      return err(res, 400, 'Не указан ID счёта', 'VALIDATION_ERROR');
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'Сумма должна быть целым числом', 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE — блокируем строку счёта на время транзакции, чтобы два
    // одновременных платежа не читали один и тот же устаревший paid_kopecks.
    const invRows = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoice_id]);
    if (!invRows.rows.length || invRows.rows[0].org_id !== req.user.org_id) {
      await client.query('ROLLBACK');
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    }
    const inv = invRows.rows[0];

    if (PAYMENT_BLOCKED_STATUSES.includes(inv.status)) {
      await client.query('ROLLBACK');
      return err(res, 400, `Счёт в статусе ${inv.status} не принимает платежи`, 'INVOICE_STATE_INVALID');
    }

    const remaining = inv.amount_kopecks - inv.paid_kopecks;
    if (amount_kopecks > remaining) {
      await client.query('ROLLBACK');
      return err(res, 400, `Сумма превышает остаток к оплате. Максимум: ${(remaining / 100).toFixed(2)} ₽`, 'PAYMENT_VALIDATION_ERROR');
    }

    const { rows } = await client.query(`
      INSERT INTO payments(invoice_id, org_id, amount_kopecks, method, reference, payment_date, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [invoice_id, inv.org_id, amount_kopecks,
        method || 'bank_transfer', reference || null,
        payment_date || new Date().toISOString().slice(0,10), req.user.id]);

    const newPaid   = inv.paid_kopecks + amount_kopecks;
    const newStatus = newPaid >= inv.amount_kopecks ? 'PAID' : 'PARTIALLY_PAID';

    await client.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [newPaid, newStatus, invoice_id]);

    await client.query('COMMIT');

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
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[payment create]');
  } finally {
    client.release();
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
    return dbErr(res, e, '[counterparties]');
  }
});

app.post('/api/v1/counterparties', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type } = req.body || {};
  if (!name || !name.trim())
    return err(res, 400, 'Укажите название', 'VALIDATION_ERROR');

  try {
    const { rows } = await pool.query(`
      INSERT INTO counterparties(org_id, name, inn, kpp, phone, email, address, type)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.user.org_id, name.trim(), inn || null, kpp || null, phone || null,
        email || null, address || null, type || 'vendor']);

    await audit(req.user.org_id, req.user.id, 'counterparty.created', 'counterparty', rows[0].id, null, { name });
    return ok(res, rows[0], 201);
  } catch (e) {
    return dbErr(res, e, '[counterparty create]');
  }
});

app.patch('/api/v1/counterparties/:id', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type, is_active } = req.body || {};
  try {
    const existing = await pool.query('SELECT * FROM counterparties WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE counterparties SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        phone = COALESCE($4, phone), email = COALESCE($5, email), address = COALESCE($6, address),
        type = COALESCE($7, type), is_active = COALESCE($8, is_active)
      WHERE id = $9 RETURNING *
    `, [name ?? null, inn ?? null, kpp ?? null, phone ?? null, email ?? null, address ?? null, type ?? null, is_active ?? null, req.params.id]);

    await audit(req.user.org_id, req.user.id, 'counterparty.updated', 'counterparty', req.params.id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[counterparty update]');
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
    if (!rows.length) return err(res, 404, 'Пользователь не найден', 'NOT_FOUND');
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
    return dbErr(res, e, '[users/me]');
  }
});

app.patch('/api/v1/users/me/password', authMiddleware, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return err(res, 400, 'Укажите текущий и новый пароль', 'VALIDATION_ERROR');
  if (new_password.length < 8)
    return err(res, 400, 'Новый пароль должен содержать не менее 8 символов', 'VALIDATION_ERROR');

  try {
    const check = await pool.query(
      'SELECT id FROM users WHERE id=$1 AND password_hash = crypt($2, password_hash)',
      [req.user.id, current_password]
    );
    if (!check.rows.length) return err(res, 401, 'Текущий пароль неверен', 'UNAUTHORIZED');

    await pool.query(
      `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), updated_at = NOW() WHERE id = $2`,
      [new_password, req.user.id]
    );
    await audit(req.user.org_id, req.user.id, 'user.password_changed', 'user', req.user.id, null, null);
    return ok(res, { message: 'Пароль изменён' });
  } catch (e) {
    return dbErr(res, e, '[password change]');
  }
});

app.get('/api/v1/users', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, trust_score, is_active, last_login_at, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at`,
      [req.user.org_id]
    );
    return ok(res, { items: rows });
  } catch (e) {
    return dbErr(res, e, '[users list]');
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
    return dbErr(res, e, '[audit]');
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
    return dbErr(res, e, '[admin overview]');
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
    return dbErr(res, e, '[admin organizations]');
  }
});

// ─── 404 ─────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Маршрут ${req.method} ${req.path} не найден` } });
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
