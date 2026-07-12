const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

const PERMISSIONS = {
  owner:       ['invoices:*','payments:*','org:admin','audit:read'],
  accountant:  ['invoices:read','invoices:write','payments:read','payments:write'],
  vendor_admin:['invoices:read','payments:read','audit:read','vendor:admin'],
  readonly:    ['invoices:read','payments:read'],
};

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.*, o.name AS org_name, o.plan
       FROM users u
       LEFT JOIN organizations o ON u.org_id = o.id
       WHERE u.id = $1`, [req.user.id]
    );
    if (!rows.length) return err(res, 404, 'Пользователь не найден', 'NOT_FOUND');
    const u = rows[0];
    return ok(res, {
      id: u.id, email: u.email, name: u.name, role: u.role,
      org_id: u.org_id, org_name: u.org_name, plan: u.plan,
      permissions: PERMISSIONS[u.role] || [],
    });
  } catch (e) {
    return dbErr(res, e, '[users/me]');
  }
});

router.patch('/me/password', authMiddleware, async (req, res) => {
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

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, name, role, is_active, last_login_at, created_at
       FROM users WHERE org_id = $1 ORDER BY created_at`,
      [req.user.org_id]
    );
    return ok(res, { items: rows });
  } catch (e) {
    return dbErr(res, e, '[users list]');
  }
});

module.exports = router;
