const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware, revokeAllUserSessions, signToken, TOKEN_TTL_S,
        readAdminRevocationCutoff } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();

// Смена пароля выписывает новый токен, поэтому без лимита её можно было
// крутить в цикле — это и была педаль для гонки с отзывом прав, и заодно
// онлайн-перебор текущего пароля. Лимит по пользователю и по IP.
const passwordChangeLimiter = rateLimit({
  keyFn: (req) => `pwchange:${req.user?.id || req.ip}`,
  max: 5, windowSeconds: 15 * 60,
  message: 'Слишком много попыток смены пароля. Попробуйте через 15 минут.',
});

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

router.patch('/me/password', authMiddleware, passwordChangeLimiter, async (req, res) => {
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

    // Все прочие сессии завершаются; текущей выдаём свежий токен,
    // чтобы пользователь не вылетел сразу после смены пароля.
    // Отзыв больше не молчит об ошибке: если он не удался, честно говорим
    // об этом и НЕ выдаём новый токен (старый и так остаётся рабочим —
    // отметки отзыва нет).
    let sessionsRevoked = true;
    try {
      await revokeAllUserSessions(req.user.id, 'password');
    } catch (e) {
      sessionsRevoked = false;
      console.warn('[password change] revoke failed:', e.message);
    }

    // Флаг администратора платформы перечитываем из БД ПОСЛЕ записи
    // собственной отметки отзыва, а не берём из RETURNING * прошлого UPDATE
    // и тем более не из req.user (payload старого токена). Иначе снимаемый
    // админ выигрывал гонку: читал is_platform_admin=true до коммита демоции,
    // а подписывал токен уже после обеих отметок отзыва.
    // Дополнительная страховка от микросекундного окна между SELECT и
    // подписью: если отметка отзыва по admin-флагу оказалась НЕ старше
    // момента чтения, значит демоция могла произойти после нашего SELECT —
    // перечитываем и переподписываем, а при неопределённости токен не выдаём.
    let token = null;
    if (sessionsRevoked) {
      for (let attempt = 0; attempt < 2 && !token; attempt++) {
        const readAt = Date.now();
        const fresh = await pool.query(
          'SELECT id, email, name, role, org_id, is_platform_admin FROM users WHERE id=$1',
          [req.user.id]
        );
        if (!fresh.rows.length) return err(res, 404, 'Пользователь не найден', 'NOT_FOUND');
        const candidate = signToken(fresh.rows[0]);
        let adminCutoff;
        try {
          adminCutoff = await readAdminRevocationCutoff(req.user.id);
        } catch (e) {
          console.warn('[password change] admin cutoff read failed:', e.message);
          break; // неизвестно — токен не выдаём, пользователь войдёт заново
        }
        if (adminCutoff < readAt) token = candidate.token;
      }
    }

    await audit(req.user.org_id, req.user.id, 'user.password_changed', 'user', req.user.id, null,
      { sessions_revoked: sessionsRevoked });
    return ok(res, {
      message: sessionsRevoked
        ? 'Пароль изменён, остальные сессии завершены'
        : 'Пароль изменён, но завершить другие сессии не удалось — смените пароль повторно позже',
      sessions_revoked: sessionsRevoked,
      access_token: token,
      expires_in: token ? TOKEN_TTL_S : 0,
    });
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
