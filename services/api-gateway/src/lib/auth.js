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

// Ключи отметок отзыва. РАЗНЫЕ для разных причин: раньше и смена пароля,
// и снятие platform-admin писали в один pwrev_s:<id>, и отзыв по паролю,
// выполненный на долю секунды позже, «перекрывал» отзыв по снятию прав —
// токен, подписанный после обоих, проходил проверку с admin:true (TOCTOU).
// Теперь метки независимы, а authMiddleware берёт максимум из обеих.
const REVOKE_KEYS = {
  password: (id) => `pwrev_s:${id}`,
  admin:    (id) => `adminrev_s:${id}`,
};

// Отметки хранятся в МИЛЛИСЕКУНДАХ. Стандартный jwt-claim iat — в секундах,
// поэтому сравнение «iat < cutoff» имело гранулярность в секунду: всё, что
// выписано в ту же секунду, что и отзыв, считалось валидным — окно в целую
// секунду, которого хватало на гонку. Кладём в payload собственное поле
// iat_ms и сравниваем по нему.
function issuedAtMs(payload) {
  if (Number.isFinite(payload.iat_ms)) return payload.iat_ms;
  // Токены, выписанные до этого изменения: секунды -> начало секунды.
  // Округление вниз намеренно строгое (fail-safe): старый токен, выданный
  // в ту же секунду, что и отзыв, теперь считается отозванным.
  return Number(payload.iat) * 1000;
}

// Совместимость с отметками, записанными до перехода на миллисекунды
// (10-значный unix-time в секундах против 13-значного в миллисекундах).
function normalizeCutoff(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < 1e12 ? v * 1000 : v;
}

function signToken(user) {
  const jti = randomUUID();
  const token = jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role, email: user.email,
      admin: !!user.is_platform_admin, jti, iat_ms: Date.now() },
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

  // Факт выполнения проверки отзыва фиксируется явно: true — обращение к
  // Redis состоялось (независимо от результата), false — упало. Раньше
  // ошибка просто глоталась, и запрос шёл дальше с доверием к payload —
  // на время недоступности Redis снятый админ снова становился админом.
  let revocationChecked = false;
  let revokedByAdminChange = false;
  try {
    const [revoked, pwCutoffRaw, adminCutoffRaw] = await redis.mget(
      `revoked:${payload.jti}`,
      REVOKE_KEYS.password(payload.sub),
      REVOKE_KEYS.admin(payload.sub),
    );
    revocationChecked = true;
    if (revoked) return err(res, 401, 'Токен отозван', 'UNAUTHORIZED');

    // Отметок две (пароль и смена platform-admin) — действует более поздняя.
    const pwCutoff    = normalizeCutoff(pwCutoffRaw);
    const adminCutoff = normalizeCutoff(adminCutoffRaw);
    const cutoff = Math.max(pwCutoff, adminCutoff);
    revokedByAdminChange = adminCutoff >= pwCutoff;
    if (cutoff && issuedAtMs(payload) < cutoff)
      return err(res, 401, revokedByAdminChange
        ? 'Права администратора платформы изменены — войдите заново'
        : 'Сессия завершена после смены пароля — войдите заново', 'UNAUTHORIZED');
  } catch (e) {
    // Обычные эндпоинты продолжают работать (падение Redis не должно класть
    // весь продукт), но факт непроверенности отзыва протаскивается дальше —
    // requirePlatformAdmin на нём фейлится закрыто.
    revocationChecked = false;
    console.warn('[auth] revocation check FAILED (admin routes will fail closed):', e.message);
  }

  req.user = {
    id: payload.sub, org_id: payload.org, role: payload.role, email: payload.email,
    is_platform_admin: !!payload.admin, jti: payload.jti,
    revocation_checked: revocationChecked,
  };
  next();
}

function requirePlatformAdmin(req, res, next) {
  if (!req.user?.is_platform_admin) return err(res, 403, 'Требуются права администратора платформы', 'FORBIDDEN');
  // Асимметрия намеренная: только для /admin/* мы отказываемся доверять
  // admin:true из токена, если актуальность прав подтвердить не удалось.
  // Цена ошибки здесь — полный доступ к платформе, поэтому fail-closed.
  if (req.user.revocation_checked !== true)
    return err(res, 503, 'Проверка актуальности прав администратора временно недоступна, попробуйте позже', 'SERVICE_UNAVAILABLE');
  next();
}

// Отзыв всех активных сессий пользователя.
// scope: 'password' — смена/сброс пароля, 'admin' — изменение platform-admin.
// Ошибку НЕ глотает: вызывающий обязан решить, что делать с неудачей
// (раньше молчаливый catch приводил к аудит-логу, врущему про отзыв).
// Отметка живёт дольше TTL токена, чтобы пережить все выданные до неё токены.
async function revokeAllUserSessions(userId, scope = 'password') {
  const keyFn = REVOKE_KEYS[scope];
  if (!keyFn) throw new Error(`unknown revocation scope: ${scope}`);
  await redis.set(keyFn(userId), String(Date.now()), 'EX', TOKEN_TTL_S + 3600);
  return true;
}

// Текущая отметка отзыва по смене platform-admin, в миллисекундах (0 — нет).
// Нужна тем, кто подписывает новый токен с флагом admin: позволяет убедиться,
// что между чтением флага из БД и подписью не прилетела демоция.
// Ошибку Redis не глотает — вызывающий обязан трактовать её как «неизвестно».
async function readAdminRevocationCutoff(userId) {
  return normalizeCutoff(await redis.get(REVOKE_KEYS.admin(userId)));
}

// Вариант для мест, где неудача отзыва не должна ронять операцию
// (например, массовый отзыв при удалении организации). Возвращает
// признак успеха, чтобы вызывающий мог честно отразить его в ответе/аудите.
async function tryRevokeAllUserSessions(userId, scope = 'password') {
  try {
    await revokeAllUserSessions(userId, scope);
    return true;
  } catch (e) {
    console.warn('[auth] revoke-all failed:', e.message);
    return false;
  }
}

module.exports = {
  JWT_SECRET, TOKEN_TTL_S, signToken, authMiddleware, requirePlatformAdmin,
  revokeAllUserSessions, tryRevokeAllUserSessions, readAdminRevocationCutoff,
};
