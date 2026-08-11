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
  signToken, authMiddleware, requirePlatformAdmin,
  revokeAllUserSessions, tryRevokeAllUserSessions, readAdminRevocationCutoff,
} = require('../src/lib/auth');

// ---------------------------------------------------------------------------
// Мини-харнесс: прогоняет цепочку authMiddleware -> requirePlatformAdmin
// и возвращает, чем всё кончилось (статус ошибки или пропуск дальше).
// ---------------------------------------------------------------------------
function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set() { return this; },
  };
}

async function runAuth(token, { admin = false } = {}) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = makeRes();
  let passedAuth = false;
  await authMiddleware(req, res, () => { passedAuth = true; });
  if (!passedAuth) return { allowed: false, status: res.statusCode, code: res.body?.error?.code, req, res };
  if (!admin) return { allowed: true, status: 200, req, res };
  let passedAdmin = false;
  requirePlatformAdmin(req, res, () => { passedAdmin = true; });
  return { allowed: passedAdmin, status: passedAdmin ? 200 : res.statusCode, code: res.body?.error?.code, req, res };
}

function reset() { store.clear(); redisDown = false; }

const ADMIN_USER = { id: 'u-admin', org_id: 'o1', role: 'owner', email: 'a@b.c', is_platform_admin: true };
const PLAIN_USER = { id: 'u-plain', org_id: 'o1', role: 'accountant', email: 'p@b.c', is_platform_admin: false };

// ---------------------------------------------------------------------------
// Дефект 1 (PoC пентестера): fail-open при недоступном Redis.
// ---------------------------------------------------------------------------

test('PoC #1: при недоступном Redis admin-эндпоинт больше не пропускает по токену (503, не 200)', async () => {
  reset();
  const { token } = signToken(ADMIN_USER);
  // Права сняты, отметка отзыва записана — но Redis лежит и прочитать её нельзя.
  await revokeAllUserSessions(ADMIN_USER.id, 'admin');
  redisDown = true;

  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.allowed, false, 'снятый админ не должен пройти на /admin/* при недоступном Redis');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(r.req.user.revocation_checked, false);
});

test('обычные (не-admin) эндпоинты при недоступном Redis продолжают работать', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  redisDown = true;
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, true, 'падение Redis не должно класть весь продукт');
  assert.strictEqual(r.req.user.revocation_checked, false);
});

test('здоровый Redis: проверка выполнена, действующий админ проходит', async () => {
  reset();
  const { token } = signToken(ADMIN_USER);
  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.req.user.revocation_checked, true);
});

test('revocation_checked=true и когда токен НЕ отозван, и когда проверка просто ничего не нашла', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token);
  assert.strictEqual(r.req.user.revocation_checked, true);
});

test('не-админ на admin-эндпоинте получает 403, а не 503 (порядок проверок сохранён)', async () => {
  reset();
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.code, 'FORBIDDEN');
});

// ---------------------------------------------------------------------------
// Дефект 1b: revokeAllUserSessions обязана сообщать о неудаче.
// ---------------------------------------------------------------------------

test('revokeAllUserSessions пробрасывает ошибку Redis наружу (раньше молча глоталась)', async () => {
  reset();
  redisDown = true;
  await assert.rejects(() => revokeAllUserSessions('u1', 'admin'), /Redis/);
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
  await assert.rejects(() => revokeAllUserSessions('u1', 'whatever'), /unknown revocation scope/);
});

// ---------------------------------------------------------------------------
// Дефект 2 (PoC пентестера): гонка между двумя типами отзыва.
// ---------------------------------------------------------------------------

test('PoC #2: отзыв по смене пароля больше не затирает отзыв по снятию platform-admin', async () => {
  reset();
  await revokeAllUserSessions(ADMIN_USER.id, 'admin');   // демоция
  const { token } = signToken(ADMIN_USER);               // старый admin-токен «до» демоции
  // Атакующий тут же дёргает смену пароля — она пишет СВОЮ метку, позже по времени.
  await new Promise((r) => setTimeout(r, 5));
  await revokeAllUserSessions(ADMIN_USER.id, 'password');

  // Раньше обе метки жили в одном ключе pwrev_s и вторая перезаписывала первую.
  assert.ok(store.has(`adminrev_s:${ADMIN_USER.id}`), 'метка отзыва по admin-флагу должна сохраниться');
  assert.ok(store.has(`pwrev_s:${ADMIN_USER.id}`));
  assert.notStrictEqual(store.get(`adminrev_s:${ADMIN_USER.id}`), store.get(`pwrev_s:${ADMIN_USER.id}`));
});

test('authMiddleware берёт МАКСИМАЛЬНЫЙ cutoff из обоих ключей', async () => {
  reset();
  const uid = ADMIN_USER.id;
  const now = Date.now();
  store.set(`pwrev_s:${uid}`, String(now - 10_000));    // старая метка по паролю
  store.set(`adminrev_s:${uid}`, String(now + 5_000));  // более поздняя метка по демоции
  const token = jwt.sign(
    { sub: uid, org: 'o1', role: 'owner', email: 'a@b.c', admin: true, jti: 'j1', iat_ms: now },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.allowed, false, 'токен старше admin-метки обязан быть отклонён');
  assert.strictEqual(r.status, 401);
  assert.match(r.res.body?.error?.message || '', /администратора платформы/i);
});

test('миллисекундная точность: токен, выданный на 10 мс РАНЬШЕ отзыва в ту же секунду, отклоняется', async () => {
  reset();
  const uid = ADMIN_USER.id;
  const base = Date.now();
  const token = jwt.sign(
    { sub: uid, org: 'o1', role: 'owner', email: 'a@b.c', admin: true, jti: 'j2', iat_ms: base },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`adminrev_s:${uid}`, String(base + 10)); // та же секунда, но позже на 10 мс
  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.allowed, false, 'секундная гранулярность давала здесь целое окно для гонки');
  assert.strictEqual(r.status, 401);
});

test('токен, выданный ПОСЛЕ отзыва, остаётся валидным (смена пароля не разлогинивает саму себя)', async () => {
  reset();
  await revokeAllUserSessions(PLAIN_USER.id, 'password');
  await new Promise((r) => setTimeout(r, 2));
  const { token } = signToken(PLAIN_USER);
  const r = await runAuth(token);
  assert.strictEqual(r.allowed, true);
});

test('старые токены без iat_ms и метки в секундах обрабатываются (обратная совместимость)', async () => {
  reset();
  const uid = 'legacy-user';
  const nowS = Math.floor(Date.now() / 1000);
  const legacy = jwt.sign(
    { sub: uid, org: 'o1', role: 'owner', email: 'l@b.c', admin: true, jti: 'j3', iat: nowS - 60 },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`pwrev_s:${uid}`, String(nowS - 30)); // старый формат: секунды
  const r = await runAuth(legacy, { admin: true });
  assert.strictEqual(r.allowed, false, 'метка в секундах должна нормализоваться в мс и отозвать токен');
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------------------
// Страховка, которой пользуется PATCH /users/me/password при переподписи токена.
// ---------------------------------------------------------------------------

test('readAdminRevocationCutoff: 0 без метки, значение с меткой, исключение при падении Redis', async () => {
  reset();
  assert.strictEqual(await readAdminRevocationCutoff('u1'), 0);
  await revokeAllUserSessions('u1', 'admin');
  assert.ok((await readAdminRevocationCutoff('u1')) > 0);
  redisDown = true;
  await assert.rejects(() => readAdminRevocationCutoff('u1'));
});

test('сценарий гонки целиком: демоция во время смены пароля — новый токен не получает admin:true', async () => {
  reset();
  const uid = ADMIN_USER.id;
  // Имитация обработчика PATCH /users/me/password в его новом порядке:
  // 1) метка отзыва по паролю, 2) чтение флага из БД, 3) подпись,
  // 4) контроль, что демоция не прилетела после чтения.
  let dbAdminFlag = true;                       // в БД пока ещё админ
  await revokeAllUserSessions(uid, 'password'); // (1)

  let token = null;
  for (let attempt = 0; attempt < 2 && !token; attempt++) {
    const readAt = Date.now();
    const flag = dbAdminFlag;                   // (2) чтение из БД
    // Гонка: ровно в этот момент проходит демоция (коммит + отзыв).
    if (attempt === 0) {
      dbAdminFlag = false;
      await new Promise((r) => setTimeout(r, 2));
      await revokeAllUserSessions(uid, 'admin');
    }
    const candidate = signToken({ ...ADMIN_USER, is_platform_admin: flag }); // (3)
    const cutoff = await readAdminRevocationCutoff(uid);                     // (4)
    if (cutoff < readAt) token = candidate.token;
  }

  assert.ok(token, 'токен всё же должен быть выдан — со второй попытки');
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  assert.strictEqual(payload.admin, false, 'выигранная гонка больше не даёт admin:true на 24 часа');
  const r = await runAuth(token, { admin: true });
  assert.strictEqual(r.status, 403, 'и на /admin/* такой токен получает 403');
});
