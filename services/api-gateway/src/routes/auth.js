const express = require('express');
const { randomUUID } = require('crypto');
const { createHash } = require('crypto');
const { pool } = require('../lib/db');
const { redis } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { signToken, authMiddleware, TOKEN_TTL_S } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { rateLimit } = require('../lib/rateLimit');
const mailer = require('../lib/mailer');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// По IP — от подбора пароля/перебора email по всей платформе;
// по IP+email — чтобы точечная атака на один аккаунт не ждала общего лимита IP.
const loginLimiter = rateLimit({
  keyFn: (req) => `login:${req.ip}:${(req.body?.email || '').toLowerCase().trim()}`,
  max: 10, windowSeconds: 15 * 60,
  message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
});
const registerLimiter = rateLimit({
  keyFn: (req) => `register:${req.ip}`,
  max: 10, windowSeconds: 60 * 60,
  message: 'Слишком много регистраций с этого адреса. Попробуйте позже.',
});

router.post('/register', registerLimiter, async (req, res) => {
  const { org_name, email, password, name, consent } = req.body || {};
  if (!org_name || !org_name.trim())
    return err(res, 400, 'Укажите название организации', 'VALIDATION_ERROR');
  if (!email || !EMAIL_RE.test(email))
    return err(res, 400, 'Укажите корректный email', 'VALIDATION_ERROR');
  if (!password || password.length < 8)
    return err(res, 400, 'Пароль должен содержать не менее 8 символов', 'VALIDATION_ERROR');
  // 152-ФЗ «О персональных данных» — без явного согласия обрабатывать email/имя нельзя.
  if (consent !== true)
    return err(res, 400, 'Необходимо согласие на обработку персональных данных', 'CONSENT_REQUIRED');

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
      INSERT INTO users(email, password_hash, name, role, org_id, pdn_consent_at)
      VALUES($1, crypt($2, gen_salt('bf')), $3, 'owner', $4, NOW()) RETURNING *
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
        is_platform_admin: false,
      }
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[register]');
  } finally {
    client.release();
  }
});

router.post('/login', loginLimiter, async (req, res) => {
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
        is_platform_admin: !!u.is_platform_admin
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

const forgotPasswordLimiter = rateLimit({
  keyFn: (req) => `forgot:${req.ip}:${(req.body?.email || '').toLowerCase().trim()}`,
  max: 5, windowSeconds: 60 * 60,
  message: 'Слишком много запросов на сброс пароля. Попробуйте через час.',
});

const RESET_TOKEN_TTL_MIN = 30;

router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body || {};
  if (!email || !EMAIL_RE.test(email))
    return err(res, 400, 'Укажите корректный email', 'VALIDATION_ERROR');

  // Ответ всегда одинаковый вне зависимости от того, найден пользователь или
  // нет — иначе эндпоинт превращается в оракул для перебора зарегистрированных email.
  const genericResponse = { message: 'Если такой email зарегистрирован, на него отправлена ссылка для сброса пароля' };

  try {
    const { rows } = await pool.query('SELECT id FROM users WHERE email=$1 AND is_active=true', [email.toLowerCase().trim()]);
    if (!rows.length) return ok(res, genericResponse);

    const userId = rows[0].id;
    const rawToken = randomUUID() + randomUUID();
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    await pool.query(
      `INSERT INTO password_reset_tokens(user_id, token_hash, expires_at)
       VALUES($1, $2, NOW() + INTERVAL '${RESET_TOKEN_TTL_MIN} minutes')`,
      [userId, tokenHash]
    );

    const resetUrl = `${process.env.APP_BASE_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
    await mailer.sendMail({
      to: email,
      subject: 'Сброс пароля — Счёт&Контроль',
      text: `Для сброса пароля перейдите по ссылке (действует ${RESET_TOKEN_TTL_MIN} минут):\n${resetUrl}\n\nЕсли вы не запрашивали сброс — проигнорируйте это письмо.`,
    });

    await audit(null, userId, 'auth.password_reset_requested', 'user', userId, null, null);
    return ok(res, genericResponse);
  } catch (e) {
    return dbErr(res, e, '[forgot-password]');
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token) return err(res, 400, 'Токен не передан', 'VALIDATION_ERROR');
  if (!new_password || new_password.length < 8)
    return err(res, 400, 'Пароль должен содержать не менее 8 символов', 'VALIDATION_ERROR');

  try {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      `SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW()`,
      [tokenHash]
    );
    if (!rows.length) return err(res, 400, 'Ссылка недействительна или устарела', 'TOKEN_INVALID');
    const record = rows[0];

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE users SET password_hash = crypt($1, gen_salt('bf')), updated_at = NOW() WHERE id = $2`,
        [new_password, record.user_id]
      );
      await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1', [record.id]);
      // Все прочие непогашенные токены этого пользователя тоже аннулируются
      await client.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL', [record.user_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    await audit(null, record.user_id, 'auth.password_reset_completed', 'user', record.user_id, null, null);
    return ok(res, { message: 'Пароль изменён, теперь можно войти' });
  } catch (e) {
    return dbErr(res, e, '[reset-password]');
  }
});

router.get('/invite/:token', async (req, res) => {
  try {
    const tokenHash = createHash('sha256').update(req.params.token).digest('hex');
    const { rows } = await pool.query(`
      SELECT oi.email, oi.role, o.name AS org_name
      FROM org_invites oi JOIN organizations o ON o.id = oi.org_id
      WHERE oi.token_hash=$1 AND oi.used_at IS NULL AND oi.expires_at > NOW()
    `, [tokenHash]);
    if (!rows.length) return err(res, 400, 'Приглашение недействительно или истекло', 'TOKEN_INVALID');
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[invite lookup]');
  }
});

router.post('/accept-invite', async (req, res) => {
  const { token, name, password, consent } = req.body || {};
  if (!token) return err(res, 400, 'Токен не передан', 'VALIDATION_ERROR');
  if (!password || password.length < 8)
    return err(res, 400, 'Пароль должен содержать не менее 8 символов', 'VALIDATION_ERROR');
  if (consent !== true)
    return err(res, 400, 'Необходимо согласие на обработку персональных данных', 'CONSENT_REQUIRED');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tokenHash = createHash('sha256').update(token).digest('hex');
    const inviteRows = await client.query(
      `SELECT * FROM org_invites WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() FOR UPDATE`,
      [tokenHash]
    );
    if (!inviteRows.rows.length) {
      await client.query('ROLLBACK');
      return err(res, 400, 'Приглашение недействительно или истекло', 'TOKEN_INVALID');
    }
    const invite = inviteRows.rows[0];

    const existing = await client.query('SELECT id FROM users WHERE email=$1', [invite.email]);
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return err(res, 409, 'Пользователь с таким email уже зарегистрирован', 'ALREADY_EXISTS');
    }

    const userRows = await client.query(`
      INSERT INTO users(email, password_hash, name, role, org_id, pdn_consent_at)
      VALUES($1, crypt($2, gen_salt('bf')), $3, $4, $5, NOW()) RETURNING *
    `, [invite.email, password, (name || '').trim() || null, invite.role, invite.org_id]);
    const u = userRows.rows[0];

    await client.query('UPDATE org_invites SET used_at = NOW() WHERE id = $1', [invite.id]);
    await client.query('COMMIT');

    const orgRows = await pool.query('SELECT name, plan FROM organizations WHERE id=$1', [invite.org_id]);
    await audit(invite.org_id, u.id, 'org.invite_accepted', 'user', u.id, null, { email: u.email, role: u.role });

    const { token: authToken } = signToken(u);
    return ok(res, {
      access_token: authToken,
      refresh_token: authToken,
      expires_in: TOKEN_TTL_S,
      user: {
        id: u.id, email: u.email, name: u.name, role: u.role,
        org_id: invite.org_id, org_name: orgRows.rows[0].name, plan: orgRows.rows[0].plan,
        is_platform_admin: false,
      }
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[accept-invite]');
  } finally {
    client.release();
  }
});

module.exports = router;
