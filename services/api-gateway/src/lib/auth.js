const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { redis } = require('./db');
const { err } = require('./http');

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
    // Смена/сброс пароля отзывает все сессии пользователя: токены,
    // выданные раньше отметки, недействительны.
    // Сравнение в секундах (гранулярность iat): токен, выданный в ту же
    // секунду, что и смена пароля (в т.ч. новый токен самой смены), живёт.
    const cutoff = await redis.get(`pwrev_s:${payload.sub}`);
    if (cutoff && payload.iat < Number(cutoff))
      return err(res, 401, 'Сессия завершена после смены пароля — войдите заново', 'UNAUTHORIZED');
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

// Отзыв всех активных сессий пользователя (смена/сброс пароля).
// Хранится дольше TTL токена, чтобы отметка гарантированно пережила
// все выданные до неё токены.
async function revokeAllUserSessions(userId) {
  try {
    await redis.set(`pwrev_s:${userId}`, String(Math.floor(Date.now() / 1000)), 'EX', TOKEN_TTL_S + 3600);
  } catch (e) {
    console.warn('[auth] revoke-all failed:', e.message);
  }
}

module.exports = { JWT_SECRET, TOKEN_TTL_S, signToken, authMiddleware, requirePlatformAdmin, revokeAllUserSessions };
