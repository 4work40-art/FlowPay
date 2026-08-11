// ===========================================================================
// Вход в управление платформой — единственная точка входа контура
// platform_admins. Смонтирован на /api/v1/platform (см. server.js).
//
// Намеренно НЕ живёт в routes/auth.js: клиентский вход и вход владельца
// платформы не должны делить ни обработчик, ни лимитер, ни формат ответа.
// ===========================================================================
const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { rateLimit } = require('../lib/rateLimit');
const {
  signPlatformAdminToken, platformAdminAuthMiddleware,
  revokePlatformAdminToken, TOKEN_TTL_S,
} = require('../lib/platformAuth');

const router = express.Router();

// Лимит жёстче клиентского (10/15 мин): учётная запись здесь одна и известна,
// перебор по ней — самый очевидный вектор. Ключ по IP+email, как на /auth/login,
// плюс отдельный ключ по IP — чтобы перебор email не обходил лимит.
const platformLoginLimiter = rateLimit({
  keyFn: (req) => `platform_login:${req.ip}:${(req.body?.email || '').toLowerCase().trim()}`,
  max: 5, windowSeconds: 15 * 60,
  message: 'Слишком много попыток входа. Попробуйте через 15 минут.',
});
const platformLoginIpLimiter = rateLimit({
  keyFn: (req) => `platform_login_ip:${req.ip}`,
  max: 20, windowSeconds: 15 * 60,
  message: 'Слишком много попыток входа с этого адреса. Попробуйте позже.',
});

router.post('/login', platformLoginIpLimiter, platformLoginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password)
    return err(res, 400, 'Укажите email и пароль', 'VALIDATION_ERROR');

  try {
    // Сравнение пароля силами pgcrypto, как в клиентском /auth/login:
    // crypt($2, password_hash) воспроизводит хэш с той же солью.
    const { rows } = await pool.query(
      `SELECT id, email, name FROM platform_admins
       WHERE email = $1 AND password_hash = crypt($2, password_hash)`,
      [String(email).toLowerCase().trim(), password]
    );

    // Единый ответ на «нет такого email» и «неверный пароль» — не даём
    // подтвердить существование учётной записи.
    if (!rows.length)
      return err(res, 401, 'Неверный email или пароль', 'UNAUTHORIZED');

    const admin = rows[0];
    const { token } = signPlatformAdminToken(admin);

    await pool.query('UPDATE platform_admins SET updated_at = NOW() WHERE id = $1', [admin.id]);

    // Никакого org_id/role в ответе: у платформенного администратора нет
    // организации, и фронт админки на них не рассчитывает.
    return ok(res, {
      access_token: token,
      expires_in: TOKEN_TTL_S,
      admin: { id: admin.id, email: admin.email, name: admin.name },
    });
  } catch (e) {
    return dbErr(res, e, '[platform login]');
  }
});

router.post('/logout', platformAdminAuthMiddleware, async (req, res) => {
  try {
    await revokePlatformAdminToken(req.user.jti);
  } catch (e) {
    console.warn('[platform logout] revoke failed:', e.message);
  }
  return ok(res, { message: 'Вы вышли из панели управления платформой' });
});

// Кто я — для проверки живости сессии фронтом админки, без обращения к
// клиентскому /users/me (он в другом контуре и такой токен не примет).
router.get('/me', platformAdminAuthMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, email, name, created_at FROM platform_admins WHERE id = $1',
      [req.user.id]
    );
    // Учётная запись удалена, а токен ещё жив — отказ, а не пустой ответ.
    if (!rows.length) return err(res, 401, 'Учётная запись не найдена', 'UNAUTHORIZED');
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[platform me]');
  }
});

module.exports = router;
