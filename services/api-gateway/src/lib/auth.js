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

// Ключ отметки отзыва клиентских сессий (смена/сброс пароля, удаление
// организации). Раньше здесь был второй scope — 'admin', отзыв по изменению
// флага users.is_platform_admin. Флага больше нет: администратор платформы
// вынесен в отдельную таблицу platform_admins и отдельный контур
// (lib/platformAuth.js) со своим пространством ключей pa_*. Клиентский JWT
// больше вообще не несёт признака админа, поэтому и отзывать по нему нечего.
const REVOKE_KEYS = {
  password: (id) => `pwrev_s:${id}`,
};

// Тип токена платформенного администратора. Здесь нужен ровно для того,
// чтобы такой токен ОТВЕРГАТЬ: подпись у обоих контуров одна (общий
// JWT_SECRET), и без явной проверки платформенный токен прошёл бы в
// клиентские роуты как пользователь с sub=<id админа> и без org_id.
const PLATFORM_TOKEN_TYPE = 'platform_admin';

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

// Клиентский токен. Признака «администратор платформы» здесь больше нет
// ни в каком виде: управление платформой живёт в отдельном контуре и
// доступно только по токену из signPlatformAdminToken.
function signToken(user) {
  const jti = randomUUID();
  const token = jwt.sign(
    { sub: user.id, org: user.org_id, role: user.role, email: user.email,
      jti, iat_ms: Date.now() },
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

  // Токен платформенного администратора в клиентский контур не пускаем.
  // Подпись у него валидна (секрет общий), но это учётная запись из другой
  // таблицы: без org_id и role она провалилась бы в клиентские выборки как
  // «пользователь без организации» с непредсказуемыми последствиями.
  // Симметрично platformAdminAuthMiddleware, который отвергает клиентские.
  if (payload.typ === PLATFORM_TOKEN_TYPE)
    return err(res, 401, 'Токен администратора платформы не действует в клиентском кабинете', 'UNAUTHORIZED');

  // Факт выполнения проверки отзыва фиксируется явно: true — обращение к
  // Redis состоялось (независимо от результата), false — упало. Раньше
  // ошибка просто глоталась, и запрос шёл дальше с доверием к payload.
  let revocationChecked = false;
  try {
    const [revoked, pwCutoffRaw] = await redis.mget(
      `revoked:${payload.jti}`,
      REVOKE_KEYS.password(payload.sub),
    );
    revocationChecked = true;
    if (revoked) return err(res, 401, 'Токен отозван', 'UNAUTHORIZED');

    const cutoff = normalizeCutoff(pwCutoffRaw);
    if (cutoff && issuedAtMs(payload) < cutoff)
      return err(res, 401, 'Сессия завершена после смены пароля — войдите заново', 'UNAUTHORIZED');
  } catch (e) {
    // Клиентские эндпоинты продолжают работать (падение Redis не должно
    // класть весь продукт); признак непроверенности протаскивается дальше.
    // Для управления платформой это уже не имеет значения — она вынесена в
    // отдельный контур, который на непроверенном отзыве отвечает 503.
    revocationChecked = false;
    console.warn('[auth] revocation check FAILED:', e.message);
  }

  req.user = {
    id: payload.sub, org_id: payload.org, role: payload.role, email: payload.email,
    jti: payload.jti,
    revocation_checked: revocationChecked,
  };
  next();
}

// Фабрика middleware проверки роли. Ставится ВТОРЫМ, после authMiddleware
// (который кладёт req.user.role): фильтрует запрос по списку допустимых
// ролей, иначе 403 FORBIDDEN. Задумана как базовый фильтр записи в
// финансовые сущности (invoices/payments/counterparties доступны на запись
// только owner/accountant — см. карту PERMISSIONS в routes/users.js). Более
// строгие точечные проверки (owner-only в organizations/billing,
// RESTRICTED_TRANSITION_ROLES на переходах статуса счёта) остаются сверху —
// этот фильтр их не заменяет и не ослабляет. Код и стиль ошибки те же, что
// у существующих ролевых проверок (err(res, 403, ..., 'FORBIDDEN')).
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role))
      return err(res, 403, 'Недостаточно прав: действие недоступно для вашей роли', 'FORBIDDEN');
    return next();
  };
}

// Отзыв всех активных сессий пользователя.
// scope: сейчас единственный — 'password' (смена/сброс пароля, удаление
// организации). Параметр сохранён явным, чтобы случайная опечатка в имени
// scope падала ошибкой, а не писала отметку не в тот ключ.
// Ошибку НЕ глотает: вызывающий обязан решить, что делать с неудачей
// (раньше молчаливый catch приводил к аудит-логу, врущему про отзыв).
// Отметка живёт дольше TTL токена, чтобы пережить все выданные до неё токены.
async function revokeAllUserSessions(userId, scope = 'password') {
  const keyFn = REVOKE_KEYS[scope];
  if (!keyFn) throw new Error(`unknown revocation scope: ${scope}`);
  await redis.set(keyFn(userId), String(Date.now()), 'EX', TOKEN_TTL_S + 3600);
  return true;
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
  JWT_SECRET, TOKEN_TTL_S, PLATFORM_TOKEN_TYPE, signToken, authMiddleware,
  requireRole, revokeAllUserSessions, tryRevokeAllUserSessions,
};
