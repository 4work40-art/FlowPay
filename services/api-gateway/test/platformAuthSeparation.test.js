// ===========================================================================
// Разделение контуров: клиентский (lib/auth.js) и платформенный
// (lib/platformAuth.js).
//
// Главное свойство, которое здесь проверяется: токены двух систем ВЗАИМНО
// не валидны. Секрет подписи у них общий (одна инсталляция), поэтому одной
// только криптографии для разделения недостаточно — оно держится на
// обязательной проверке claim typ в обе стороны. Если эта проверка исчезнет,
// клиентский токен снова начнёт открывать управление платформой.
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-32+chars';

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

const { signToken, authMiddleware } = require('../src/lib/auth');
const {
  signPlatformAdminToken, platformAdminAuthMiddleware,
  revokePlatformAdminSessions, revokePlatformAdminToken, TOKEN_TYPE,
} = require('../src/lib/platformAuth');

function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    set() { return this; },
  };
}

async function run(middleware, token) {
  const req = { headers: token ? { authorization: `Bearer ${token}` } : {} };
  const res = makeRes();
  let passed = false;
  await middleware(req, res, () => { passed = true; });
  return { allowed: passed, status: passed ? 200 : res.statusCode, code: res.body?.error?.code, req, res };
}

const runPlatform = (t) => run(platformAdminAuthMiddleware, t);
const runClient   = (t) => run(authMiddleware, t);

function reset() { store.clear(); redisDown = false; }

const ADMIN = { id: 'pa-1', email: 'admin@flowpay.internal' };
const USER  = { id: 'u-1', org_id: 'o1', role: 'owner', email: 'owner@client.ru' };

// ---------------------------------------------------------------------------
// (а) Валидный платформенный токен проходит платформенный middleware.
// ---------------------------------------------------------------------------

test('(а) валидный platform-admin токен проходит platformAdminAuthMiddleware', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.req.user.id, ADMIN.id);
  assert.strictEqual(r.req.user.email, ADMIN.email);
  assert.strictEqual(r.req.user.revocation_checked, true);
});

test('payload платформенного токена типизирован и не содержит org/role', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  assert.strictEqual(payload.typ, TOKEN_TYPE);
  assert.strictEqual(payload.sub, ADMIN.id);
  assert.ok(Number.isFinite(payload.iat_ms), 'миллисекундная отметка выпуска обязательна');
  assert.strictEqual(payload.org, undefined, 'у администратора платформы нет организации');
  assert.strictEqual(payload.role, undefined, 'и нет роли внутри организации');
});

test('req.user платформенного контура не содержит org_id/role', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  const r = await runPlatform(token);
  assert.strictEqual(r.req.user.org_id, undefined);
  assert.strictEqual(r.req.user.role, undefined);
});

// ---------------------------------------------------------------------------
// (б) Клиентский токен НЕ проходит платформенный middleware.
// ---------------------------------------------------------------------------

test('(б) клиентский токен не проходит platformAdminAuthMiddleware', async () => {
  reset();
  const { token } = signToken(USER);
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false, 'клиентский токен не должен открывать управление платформой');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.code, 'UNAUTHORIZED');
});

test('(б2) подделка старого признака (admin:true в клиентском токене) не проходит', async () => {
  reset();
  // Ровно тот payload, который выписывала прежняя модель. Подпись валидна —
  // отвергнуть его может только проверка typ.
  const legacyAdminToken = jwt.sign(
    { sub: 'u-x', org: 'o1', role: 'owner', email: 'a@b.c', admin: true, jti: 'j1', iat_ms: Date.now() },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  const r = await runPlatform(legacyAdminToken);
  assert.strictEqual(r.allowed, false, 'старые admin:true токены не должны воскреснуть');
  assert.strictEqual(r.status, 401);
});

test('(б3) произвольный чужой typ не принимается', async () => {
  reset();
  const token = jwt.sign(
    { typ: 'platform_admin_x', sub: 'x', email: 'x@y.z', jti: 'j2', iat_ms: Date.now() },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

test('токен, подписанный другим секретом, не принимается', async () => {
  reset();
  const token = jwt.sign(
    { typ: TOKEN_TYPE, sub: ADMIN.id, email: ADMIN.email, jti: 'j3', iat_ms: Date.now() },
    'another-secret-value-of-sufficient-length', { expiresIn: 3600 }
  );
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

test('без заголовка Authorization — 401, а не падение', async () => {
  reset();
  const r = await runPlatform(null);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------------------
// (в) Платформенный токен НЕ проходит клиентский authMiddleware.
// ---------------------------------------------------------------------------

test('(в) platform-admin токен не проходит клиентский authMiddleware', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  const r = await runClient(token);
  assert.strictEqual(r.allowed, false, 'платформенный токен не должен работать в клиентском кабинете');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.code, 'UNAUTHORIZED');
  assert.match(r.res.body?.error?.message || '', /клиентском кабинете/i);
});

test('(в2) отказ клиентского контура не зависит от состояния Redis', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  redisDown = true; // проверка typ идёт ДО обращения к Redis
  const r = await runClient(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

// ---------------------------------------------------------------------------
// (г) Отзыв сессии немедленно гасит старый платформенный токен.
// ---------------------------------------------------------------------------

test('(г) revokePlatformAdminSessions гасит токены, выданные раньше отметки', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  await new Promise((r) => setTimeout(r, 2));
  await revokePlatformAdminSessions(ADMIN.id);

  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false, 'старый токен обязан погаснуть немедленно, а не через 24 часа');
  assert.strictEqual(r.status, 401);
  assert.match(r.res.body?.error?.message || '', /войдите заново/i);
});

test('(г2) токен, выданный ПОСЛЕ отзыва, остаётся валидным', async () => {
  reset();
  await revokePlatformAdminSessions(ADMIN.id);
  await new Promise((r) => setTimeout(r, 2));
  const { token } = signPlatformAdminToken(ADMIN);
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, true);
});

test('(г3) миллисекундная точность: токен на 10 мс раньше отзыва в ту же секунду отклоняется', async () => {
  reset();
  const base = Date.now();
  const token = jwt.sign(
    { typ: TOKEN_TYPE, sub: ADMIN.id, email: ADMIN.email, jti: 'j4', iat_ms: base },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`pa_pwrev_s:${ADMIN.id}`, String(base + 10));
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 401);
});

test('(г4) отметка в секундах (legacy-формат) нормализуется в миллисекунды', async () => {
  reset();
  const nowS = Math.floor(Date.now() / 1000);
  const token = jwt.sign(
    { typ: TOKEN_TYPE, sub: ADMIN.id, email: ADMIN.email, jti: 'j5', iat: nowS - 60 },
    process.env.JWT_SECRET, { expiresIn: 3600 }
  );
  store.set(`pa_pwrev_s:${ADMIN.id}`, String(nowS - 30));
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false);
});

test('(г5) точечный отзыв по jti (logout) гасит именно этот токен', async () => {
  reset();
  const a = signPlatformAdminToken(ADMIN);
  const b = signPlatformAdminToken(ADMIN);
  await revokePlatformAdminToken(a.jti);

  assert.strictEqual((await runPlatform(a.token)).allowed, false, 'разлогиненный токен');
  assert.strictEqual((await runPlatform(b.token)).allowed, true, 'вторая сессия не должна пострадать');
});

test('отзыв платформенных сессий пишет в СВОЁ пространство ключей (pa_*)', async () => {
  reset();
  await revokePlatformAdminSessions(ADMIN.id);
  assert.ok(store.has(`pa_pwrev_s:${ADMIN.id}`), 'ключ должен быть платформенным');
  assert.ok(!store.has(`pwrev_s:${ADMIN.id}`), 'клиентское пространство ключей не затрагивается');
});

test('клиентский отзыв не гасит платформенную сессию с совпадающим id', async () => {
  reset();
  // Патологический случай: UUID из users совпал с UUID из platform_admins.
  const sameId = 'collision-id';
  store.set(`pwrev_s:${sameId}`, String(Date.now() + 60_000));
  const { token } = signPlatformAdminToken({ id: sameId, email: ADMIN.email });
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, true, 'пространства ключей должны быть независимы');
});

test('revokePlatformAdminSessions пробрасывает ошибку Redis наружу', async () => {
  reset();
  redisDown = true;
  await assert.rejects(() => revokePlatformAdminSessions(ADMIN.id), /Redis/);
});

// ---------------------------------------------------------------------------
// (д) Fail-closed при недоступном Redis.
// ---------------------------------------------------------------------------

test('(д) при недоступном Redis платформенный контур отвечает 503, а не пропускает', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  await revokePlatformAdminSessions(ADMIN.id); // отзыв записан...
  redisDown = true;                            // ...но прочитать его нельзя

  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false, 'непроверенный отзыв = отказ, а не доверие payload');
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'SERVICE_UNAVAILABLE');
});

test('(д2) fail-closed срабатывает и для токена, который никто не отзывал', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  redisDown = true;
  const r = await runPlatform(token);
  assert.strictEqual(r.allowed, false, 'платформа не должна работать вслепую даже для «чистого» токена');
  assert.strictEqual(r.status, 503);
});

test('(д3) при недоступном Redis req.user не заполняется', async () => {
  reset();
  const { token } = signPlatformAdminToken(ADMIN);
  redisDown = true;
  const r = await runPlatform(token);
  assert.strictEqual(r.req.user, undefined, 'ни один обработчик не должен получить непроверенного админа');
});
