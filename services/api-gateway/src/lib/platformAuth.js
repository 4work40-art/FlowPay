// ===========================================================================
// Аутентификация администратора платформы — контур, полностью отдельный от
// клиентского lib/auth.js.
//
// Раньше «админ платформы» был флагом на строке users: тот же /auth/login,
// тот же клиентский JWT, тот же authMiddleware, признак admin внутри
// клиентского payload. Любая брешь в клиентском контуре автоматически
// становилась брешью в управлении всей платформой.
//
// Здесь: собственная таблица platform_admins, собственный вход
// POST /api/v1/platform/login, собственный тип токена (typ='platform_admin')
// и собственное пространство ключей отзыва в Redis (pa_*). Токены двух
// систем взаимно НЕ валидны: клиентский токен отвергается здесь по
// отсутствию typ, платформенный — в клиентском authMiddleware по его наличию.
// Общий у них только JWT_SECRET (одна и та же инсталляция), поэтому
// разделение держится именно на обязательной проверке claim typ, а не на
// том, что «подпись не сойдётся».
// ===========================================================================
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const { redis } = require('./db');
const { err } = require('./http');
const { JWT_SECRET, TOKEN_TTL_S } = require('./auth');

// Значение claim typ. Совпадение строки — единственный признак, по которому
// токен считается платформенным; проверка обязательна и жёсткая (===).
const TOKEN_TYPE = 'platform_admin';

// Отдельное пространство ключей: пересечение с клиентскими pwrev_s/revoked
// означало бы, что отзыв клиентской сессии с тем же UUID гасит админскую
// (и наоборот). Префикс pa_ гарантирует, что этого не случится даже при
// теоретическом совпадении id между таблицами users и platform_admins.
const REVOKED_TOKEN_KEY = (jti) => `pa_revoked:${jti}`;
const REVOKED_SESSIONS_KEY = (adminId) => `pa_pwrev_s:${adminId}`;

// Отметки отзыва хранятся в МИЛЛИСЕКУНДАХ — тот же паттерн, что в клиентском
// auth.js: стандартный claim iat имеет гранулярность в секунду, из-за чего
// токен, выписанный в ту же секунду, что и отзыв, проходил проверку (окно
// в целую секунду на гонку). Кладём собственное поле iat_ms.
function issuedAtMs(payload) {
  if (Number.isFinite(payload.iat_ms)) return payload.iat_ms;
  // Токен без iat_ms — округляем вниз, до начала секунды: намеренно строго
  // (fail-safe), такой токен при совпадении секунды считается отозванным.
  return Number(payload.iat) * 1000;
}

// Совместимость с отметками в секундах (10 знаков) против миллисекунд (13).
function normalizeCutoff(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v < 1e12 ? v * 1000 : v;
}

function signPlatformAdminToken(admin) {
  const jti = randomUUID();
  const token = jwt.sign(
    { typ: TOKEN_TYPE, sub: admin.id, email: admin.email, jti, iat_ms: Date.now() },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL_S }
  );
  return { token, jti };
}

// Единственный страж всех роутов /api/v1/admin/*. Делает всё сам — комбо
// вида (authMiddleware, requirePlatformAdmin) здесь не нужно и невозможно:
// клиентский authMiddleware этот токен не пропустит.
async function platformAdminAuthMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return err(res, 401, 'Токен доступа отсутствует', 'UNAUTHORIZED');

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return err(res, 401, 'Токен недействителен или истёк', 'UNAUTHORIZED');
  }

  // Ключевая проверка разделения контуров: валидная подпись сама по себе
  // ничего не значит — клиентские токены подписаны тем же секретом.
  if (payload.typ !== TOKEN_TYPE)
    return err(res, 401, 'Токен не является токеном администратора платформы', 'UNAUTHORIZED');

  // Fail-closed, как и в клиентском requirePlatformAdmin: цена ошибки —
  // полный доступ к платформе, поэтому невозможность ПРОВЕРИТЬ отзыв
  // трактуется как отказ (503), а не как «раз не проверили, значит можно».
  let revocationChecked = false;
  try {
    const [revoked, cutoffRaw] = await redis.mget(
      REVOKED_TOKEN_KEY(payload.jti),
      REVOKED_SESSIONS_KEY(payload.sub),
    );
    revocationChecked = true;
    if (revoked) return err(res, 401, 'Токен отозван', 'UNAUTHORIZED');

    const cutoff = normalizeCutoff(cutoffRaw);
    if (cutoff && issuedAtMs(payload) < cutoff)
      return err(res, 401, 'Сессия администратора платформы завершена — войдите заново', 'UNAUTHORIZED');
  } catch (e) {
    console.warn('[platformAuth] revocation check FAILED (fail closed):', e.message);
    revocationChecked = false;
  }

  if (!revocationChecked)
    return err(res, 503, 'Проверка актуальности сессии администратора платформы временно недоступна, попробуйте позже', 'SERVICE_UNAVAILABLE');

  // Намеренно НЕТ org_id и role: у администратора платформы нет организации
  // и нет роли внутри неё. Любой код, который попробует их прочитать,
  // получит undefined, а не «случайно подходящую» организацию.
  req.user = {
    id: payload.sub,
    email: payload.email,
    jti: payload.jti,
    is_platform_admin_account: true,
    revocation_checked: true,
  };
  next();
}

// Отзыв всех активных сессий администратора платформы (смена пароля,
// компрометация). Ошибку НЕ глотает: вызывающий обязан решить, что делать
// с неудачей — молчаливый catch приводил бы к ответу/аудиту, врущему про отзыв.
// Отметка живёт дольше TTL токена, чтобы пережить все выданные до неё токены.
async function revokePlatformAdminSessions(adminId) {
  await redis.set(REVOKED_SESSIONS_KEY(adminId), String(Date.now()), 'EX', TOKEN_TTL_S + 3600);
  return true;
}

// Точечный отзыв одного токена (logout).
async function revokePlatformAdminToken(jti) {
  await redis.set(REVOKED_TOKEN_KEY(jti), '1', 'EX', TOKEN_TTL_S);
  return true;
}

module.exports = {
  TOKEN_TYPE, TOKEN_TTL_S,
  signPlatformAdminToken, platformAdminAuthMiddleware,
  revokePlatformAdminSessions, revokePlatformAdminToken,
};
