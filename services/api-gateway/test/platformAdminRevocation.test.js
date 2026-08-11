const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

// Регрессия на отзыв сессий при смене users.is_platform_admin.
//
// Что здесь доказывается (и почему это важно):
// флаг администратора платформы зашивается в JWT в момент выдачи токена
// (signToken -> admin: !!user.is_platform_admin), а authMiddleware читает
// его из payload и НЕ перечитывает из БД. Значит `UPDATE users SET
// is_platform_admin=false` прямым SQL сам по себе НЕ отзывает уже выданные
// токены: снятый админ остаётся админом до истечения TOKEN_TTL_S (24 часа).
// Единственное, что гасит старые токены — отметка pwrev_s:<user_id>,
// которую ставит revokeAllUserSessions() из штатного эндпоинта
// PATCH /admin/users/:id/platform-admin.
//
// Тест выполняется в МОК-РЕЖИМЕ: реальный Redis в песочнице недоступен,
// поэтому ../src/lib/db подменяется in-memory двойником через require.cache
// ДО первого require('../src/lib/auth'). Логика authMiddleware при этом
// исполняется настоящая — подменён только транспорт к Redis.

process.env.JWT_SECRET = process.env.JWT_SECRET ||
  'test-secret-for-platform-admin-revocation-suite-0123456789';

// ---------------------------------------------------------------- redis double
function createRedisDouble() {
  const store = new Map();
  return {
    store,
    failing: false, // имитация недоступного Redis (см. тест про fail-open)
    async get(key) {
      if (this.failing) throw new Error('Redis unavailable (simulated)');
      return store.has(key) ? store.get(key) : null;
    },
    async set(key, value) {
      if (this.failing) throw new Error('Redis unavailable (simulated)');
      store.set(key, String(value));
      return 'OK';
    },
  };
}

const redis = createRedisDouble();

// Подменяем ../src/lib/db до его первой загрузки: настоящий db.js на require
// открывает соединения с Postgres и Redis, которых в песочнице нет.
const dbPath = require.resolve('../src/lib/db');
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].filename = dbPath;
require.cache[dbPath].path = path.dirname(dbPath);
require.cache[dbPath].loaded = true;
require.cache[dbPath].exports = { pool: { query: async () => ({ rows: [] }) }, redis };

const { signToken, authMiddleware, requirePlatformAdmin, TOKEN_TTL_S } = require('../src/lib/auth');

// ---------------------------------------------------------------- req/res моки
function mockReq(token) {
  return { headers: { authorization: `Bearer ${token}` } };
}

function mockRes() {
  const captured = { status: null, body: null };
  return {
    captured,
    status(code) { captured.status = code; return this; },
    json(payload) { captured.body = payload; return this; },
  };
}

// Прогон настоящего authMiddleware с моками. Возвращает исход: прошёл
// дальше по цепочке (passed) или был отвергнут (status/code).
async function runAuth(token) {
  const req = mockReq(token);
  const res = mockRes();
  let passed = false;
  await authMiddleware(req, res, () => { passed = true; });
  return { passed, req, status: res.captured.status, code: res.captured.body?.error?.code };
}

const OWNER = {
  id: '11111111-1111-1111-1111-111111111111',
  org_id: '22222222-2222-2222-2222-222222222222',
  role: 'owner',
  email: 'owner@example.com',
};

// ---------------------------------------------------------------- тесты

test('signToken: is_platform_admin=true попадает в токен как admin:true', async () => {
  const { token } = signToken({ ...OWNER, is_platform_admin: true });
  const { passed, req } = await runAuth(token);
  assert.strictEqual(passed, true, 'свежий токен должен проходить authMiddleware');
  assert.strictEqual(req.user.is_platform_admin, true);

  // и requirePlatformAdmin такого пользователя пропускает
  let allowed = false;
  requirePlatformAdmin(req, mockRes(), () => { allowed = true; });
  assert.strictEqual(allowed, true, 'admin:true токен проходит requirePlatformAdmin');
});

test('signToken: is_platform_admin=false даёт admin:false и 403 на requirePlatformAdmin', async () => {
  const { token } = signToken({ ...OWNER, is_platform_admin: false });
  const { passed, req } = await runAuth(token);
  assert.strictEqual(passed, true);
  assert.strictEqual(req.user.is_platform_admin, false);

  const res = mockRes();
  let allowed = false;
  requirePlatformAdmin(req, res, () => { allowed = true; });
  assert.strictEqual(allowed, false);
  assert.strictEqual(res.captured.status, 403);
  assert.strictEqual(res.captured.body.error.code, 'FORBIDDEN');
});

test('ГЛАВНОЕ: прямой UPDATE в БД без revokeAllUserSessions НЕ отзывает старый admin-токен', async () => {
  redis.store.clear();

  // 1. Пользователь вошёл, когда флаг ещё был true — на руках admin:true токен.
  const { token } = signToken({ ...OWNER, is_platform_admin: true });

  // 2. Владелец продукта снял флаг прямым SQL:
  //      UPDATE users SET is_platform_admin=false WHERE id=...
  //    Это не трогает ни Redis, ни выданные токены — моделируем как
  //    полное отсутствие каких-либо действий над состоянием сессий.
  assert.strictEqual(redis.store.size, 0, 'прямой SQL не оставляет следов в Redis');

  // 3. Старый токен продолжает проходить authMiddleware и остаётся админским.
  const after = await runAuth(token);
  assert.strictEqual(after.passed, true,
    'без revokeAllUserSessions старый токен валиден до истечения TTL — это и есть находка аудита v3');
  assert.strictEqual(after.req.user.is_platform_admin, true,
    'authMiddleware берёт admin из payload и НЕ перечитывает БД');

  let allowed = false;
  requirePlatformAdmin(after.req, mockRes(), () => { allowed = true; });
  assert.strictEqual(allowed, true,
    'обычный Owner всё ещё проходит в /admin/* — доступ «воспроизводится без изменений»');
});

test('ГЛАВНОЕ: после revokeAllUserSessions тот же самый токен отвергается', async () => {
  redis.store.clear();

  const { token } = signToken({ ...OWNER, is_platform_admin: true });
  const before = await runAuth(token);
  assert.strictEqual(before.passed, true, 'до отзыва токен валиден');

  // Штатный путь: PATCH /admin/users/:id/platform-admin вызывает
  // revokeAllUserSessions(req.params.id). Отметка ставится «сейчас», а токен
  // выдан в ту же секунду, поэтому для чистоты проверки сдвигаем cutoff
  // на секунду вперёд — так же, как это происходит в реальности, где
  // между выдачей токена и снятием прав проходит время.
  const cutoff = Math.floor(Date.now() / 1000) + 1;
  await redis.set(`pwrev_s:${OWNER.id}`, String(cutoff));

  const after = await runAuth(token);
  assert.strictEqual(after.passed, false, 'после отзыва токен НЕ должен проходить');
  assert.strictEqual(after.status, 401);
  assert.strictEqual(after.code, 'UNAUTHORIZED');
  assert.strictEqual(after.req.user, undefined, 'req.user не заполняется у отозванного токена');
});

test('отзыв точечный: отметка pwrev_s другого пользователя не трогает чужие токены', async () => {
  redis.store.clear();

  const { token } = signToken({ ...OWNER, is_platform_admin: true });
  await redis.set('pwrev_s:99999999-9999-9999-9999-999999999999',
    String(Math.floor(Date.now() / 1000) + 1));

  const { passed } = await runAuth(token);
  assert.strictEqual(passed, true, 'отзыв у чужого user_id не влияет на этого пользователя');
});

test('токен, выданный ПОСЛЕ отзыва, снова валиден (перелогин восстанавливает доступ)', async () => {
  redis.store.clear();

  const cutoff = Math.floor(Date.now() / 1000) - 5;
  await redis.set(`pwrev_s:${OWNER.id}`, String(cutoff));

  // Новый вход после отзыва: iat > cutoff, флаг читается из свежей строки БД.
  const { token } = signToken({ ...OWNER, is_platform_admin: false });
  const { passed, req } = await runAuth(token);
  assert.strictEqual(passed, true, 'свежий токен переживает старую отметку отзыва');
  assert.strictEqual(req.user.is_platform_admin, false, 'и уже не админский');
});

test('точечный отзыв по jti (logout) также отвергает токен', async () => {
  redis.store.clear();

  const { token, jti } = signToken({ ...OWNER, is_platform_admin: true });
  await redis.set(`revoked:${jti}`, '1');

  const { passed, status, code } = await runAuth(token);
  assert.strictEqual(passed, false);
  assert.strictEqual(status, 401);
  assert.strictEqual(code, 'UNAUTHORIZED');
});

test('граница cutoff: строгое < оставляет живым токен той же секунды', async () => {
  redis.store.clear();

  const { token } = signToken({ ...OWNER, is_platform_admin: true });
  const jwt = require('jsonwebtoken');
  const { iat } = jwt.verify(token, process.env.JWT_SECRET);

  // cutoff == iat: сравнение `payload.iat < Number(cutoff)` ложно -> токен живёт.
  // Для смены пароля это осознанное поведение (текущая сессия не должна
  // вылетать), но для снятия админских прав это окно гонки в <1 секунду —
  // см. отчёт, пункт «остаточный риск».
  await redis.set(`pwrev_s:${OWNER.id}`, String(iat));
  const same = await runAuth(token);
  assert.strictEqual(same.passed, true,
    'токен, выданный в ту же секунду, что и отзыв, проходит (гранулярность iat = 1 с)');

  // cutoff на секунду позже — токен уже отвергается.
  await redis.set(`pwrev_s:${OWNER.id}`, String(iat + 1));
  const later = await runAuth(token);
  assert.strictEqual(later.passed, false);
});

test('остаточный риск: при недоступном Redis проверка отзыва пропускается (fail-open)', async () => {
  redis.store.clear();

  const { token } = signToken({ ...OWNER, is_platform_admin: true });
  await redis.set(`pwrev_s:${OWNER.id}`, String(Math.floor(Date.now() / 1000) + 1));

  const revoked = await runAuth(token);
  assert.strictEqual(revoked.passed, false, 'при живом Redis токен отозван');

  // Тот же отозванный токен при недоступном Redis проходит: authMiddleware
  // ловит ошибку и продолжает (`[auth] revocation check skipped`).
  redis.failing = true;
  try {
    const bypass = await runAuth(token);
    assert.strictEqual(bypass.passed, true,
      'ЗАФИКСИРОВАНО: недоступность Redis снимает отзыв сессий — fail-open');
    assert.strictEqual(bypass.req.user.is_platform_admin, true);
  } finally {
    redis.failing = false;
  }
});

test('TOKEN_TTL_S: окно жизни неотозванного токена — 24 часа', () => {
  assert.strictEqual(TOKEN_TTL_S, 86400);
});
