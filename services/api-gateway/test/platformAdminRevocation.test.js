// ===========================================================================
// Отзыв КЛИЕНТСКИХ сессий (lib/auth.js).
//
// Исторически этот файл проверял ещё и модель «админ платформы = флаг на
// строке users»: отзыв по снятию флага (ключ adminrev_s), гонку между двумя
// типами отзыва и fail-closed на requirePlatformAdmin. Этой модели больше
// нет — администратор платформы вынесен в отдельную таблицу и отдельный
// контур (lib/platformAuth.js, тесты в platformAuthSeparation.test.js),
// клиентский JWT вообще не несёт признака админа, эндпоинт
// PATCH /admin/users/:id/platform-admin удалён.
//
// Здесь остаётся то, что не менялось и по-прежнему нужно: отзыв клиентских
// сессий по смене пароля (pwrev_s), миллисекундная точность отметки и
// обратная совместимость со старым форматом отметок.
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

// auth.js падает при старте без JWT_SECRET (>=32 символов) — задаём до require.
process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-32+chars';

// Подменяем lib/db ДО первого require('../src/lib/auth'): настоящий Redis
// и Postgres в юнит-тестах не нужны, а поведение при ПАДЕНИИ Redis — это
// ровно то, что мы здесь и проверяем.
const dbPath = require.resolve('../src/lib/db');
const store = new Map();
let redisDown = false;

const fakeRedis = {
  async get(key) {
    if (redisDown) throw new Error('Redis недоступен (тест)');
    return store.has(key) ? store.get(key) : null;
  },
  async mget(...keys) {
    if (redisDown) throw new Error('Redis недоступен (тест)');
    return keys.map((k) => (store.has(k) ? store.get(k) : null));
  },
  async set(key, value) {
    if (redisDown) throw new Error('Redis недоступен (тест)');
    store.set(key, value);
    return 'OK';
  },
};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: { pool: {}, redis: fakeRedis },
};

const {
  signToken, authMiddleware, revokeAllUserSessions, tryRevokeAllUserSessions,
} = require('../src/lib/auth');

// ---------------------------------------------------------------------------
// Мини-харнесс: прогоняет authMiddleware и возвращает, чем всё кончилось.
// ---------------------------------------------------------------------------
function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set() { return this; },
  };
}

async function runAuth(token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = makeRes();
  let passed = false;
  await authMiddleware(req, res, () => { passed = true; });
  return { allowed: passed, status: passed ? 200 : res.statusCode, code: res.body?.error?.code, req, res };
}

function reset() { store.clear(); redisDown = false; }

const PLAIN_USER = { id: 'u-plain', org_id: 'o1', role: 'accountant', email: 'p@b.c' };

// ---------------------------------------------------------------------------
// Клиентский контур переживает падение Redis (в отличие от платформенного,
// который на нём фейлится закрыто — см. platformAuthSeparation.test.js).
// ---------------------------------------------------------------------------

test('обычные эндпоинты при недоступном Redis продолжают работать', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  redisDown = true;
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, true, 'падение Redis не должно класть весь продукт');
  assert.strictEqual(r.req.user.revocation_checked, false);
});

test('здоровый Redis: проверка отзыва выполнена и отмечена', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.req.user.revocation_checked, true);
});

// ---------------------------------------------------------------------------
// Отзыв по смене пароля — механика не менялась.
// ---------------------------------------------------------------------------

test('отзыв по смене пароля гасит токены, выданные раньше отметки', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  await new Promise((r) => setTimeout(r, 2));
  await revokeAllUserSessions(PLAIN_USER.id, 'password');

  const r = await runAuth(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
  assert.match(r.res.body?.error?.message || '', /смены пароля/i);
});

test('токен, выданный ПОСЛЕ отзыва, остаётся валидным (смена пароля не разлогинивает саму себя)', async () => {
  reset();
  await revokeAllUserSessions(PLAIN_USER.id, 'password');
  await new Promise((r) => setTimeout(r, 2));
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, true);
});

test('миллисекундная точность: токен, выданный на 10 мс РАНЬШЕ отзыва в ту же секунду, отклоняется', async () => {
  reset();
  const uid = PLAIN_USER.id;
  const base = Date.now();
  const token = jwt.sign(
    { sub: uid, org: 'o1', role: 'owner', email: 'a@b.c', jti: 'j2', iat_ms: base },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`pwrev_s:${uid}`, String(base + 10)); // та же секунда, но позже на 10 мс
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, false, 'секундная гранулярность давала здесь целое окно для гонки');
  assert.strictEqual(r.status, 401);
});

test('старые токены без iat_ms и метки в секундах обрабатываются (обратная совместимость)', async () => {
  reset();
  const uid = 'legacy-user';
  const nowS = Math.floor(Date.now() / 1000);
  const legacy = jwt.sign(
    { sub: uid, org: 'o1', role: 'owner', email: 'l@b.c', jti: 'j3', iat: nowS - 60 },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`pwrev_s:${uid}`, String(nowS - 30)); // старый формат: секунды
  const r = await runAuth(legacy);
  assert.strictEqual(r.allowed, false, 'метка в секундах должна нормализоваться в мс и отозвать токен');
  assert.strictEqual(r.status, 401);
});

test('точечный отзыв токена по jti', async () => {
  reset();
  const { token, jti } = signToken(PLAIN_USER);
  store.set(`revoked:${jti}`, '1');
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------------------
// revokeAllUserSessions обязана сообщать о неудаче.
// ---------------------------------------------------------------------------

test('revokeAllUserSessions пробрасывает ошибку Redis наружу (раньше молча глоталась)', async () => {
  reset();
  redisDown = true;
  await assert.rejects(() => revokeAllUserSessions('u1', 'password'), /Redis/);
});

test('tryRevokeAllUserSessions возвращает false вместо исключения — для «мягких» мест', async () => {
  reset();
  redisDown = true;
  assert.strictEqual(await tryRevokeAllUserSessions('u1', 'password'), false);
  redisDown = false;
  assert.strictEqual(await tryRevokeAllUserSessions('u1', 'password'), true);
});

test('неизвестный scope — явная ошибка, а не тихая запись не в тот ключ', async () => {
  reset();
  // Scope 'admin' удалён вместе с моделью «флаг на users» — попытка им
  // воспользоваться должна падать, а не создавать мёртвый ключ.
  await assert.rejects(() => revokeAllUserSessions('u1', 'admin'), /unknown revocation scope/);
  await assert.rejects(() => revokeAllUserSessions('u1', 'whatever'), /unknown revocation scope/);
});

// ---------------------------------------------------------------------------
// Клиентский токен больше не несёт признака администратора платформы.
// ---------------------------------------------------------------------------

test('signToken не кладёт в payload ни admin, ни typ — признака админа в клиентском токене нет', async () => {
  reset();
  const { token } = signToken({ ...PLAIN_USER, is_platform_admin: true });
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  assert.strictEqual(payload.admin, undefined, 'claim admin должен исчезнуть полностью');
  assert.strictEqual(payload.typ, undefined, 'клиентский токен не типизируется как платформенный');
});

test('req.user клиентского контура не содержит is_platform_admin', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token);
  assert.strictEqual(r.req.user.is_platform_admin, undefined);
});
