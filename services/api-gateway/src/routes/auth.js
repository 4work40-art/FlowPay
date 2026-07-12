const express = require('express');
const { pool } = require('../lib/db');
const { redis } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { signToken, authMiddleware, TOKEN_TTL_S } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res) => {
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

router.post('/login', async (req, res) => {
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

router.post('/logout', authMiddleware, async (req, res) => {
  try {
    await redis.set(`revoked:${req.user.jti}`, '1', 'EX', TOKEN_TTL_S);
  } catch (e) {
    console.warn('[logout] revoke failed:', e.message);
  }
  return ok(res, { message: 'Вы вышли из системы' });
});

module.exports = router;
