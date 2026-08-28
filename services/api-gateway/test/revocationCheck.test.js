// ===========================================================================
// requireRevocationCheck — fail-closed для необратимых операций.
//
// authMiddleware при недоступности Redis пропускает запрос дальше с
// req.user.revocation_checked=false (падение Redis не должно класть весь
// продукт). Но этот признак раньше нигде не читался — то есть отзыв токена
// (logout / сброс пароля / удаление организации) во время сбоя Redis
// молча игнорировался на всех клиентских роутах, включая приём платежей.
//
// Тест проверяет: (1) поведение самого middleware — 503 при непроверенном
// отзыве, next при проверенном; (2) что он реально навешан на необратимые
// финансовые и связанные с безопасностью роуты (сверяем по ссылке на ту же
// экспортируемую функцию, что стоит в цепочке роута).
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-32+chars';

const dbPath = require.resolve('../src/lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { query: async () => ({ rows: [] }), connect: async () => ({}) }, redis: {} },
};

const { requireRevocationCheck } = require('../src/lib/auth');

function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function run(user) {
  const req = user === undefined ? {} : { user };
  const res = makeRes();
  let passed = false;
  requireRevocationCheck(req, res, () => { passed = true; });
  return { allowed: passed, status: res.statusCode, code: res.body?.error?.code };
}

// --- Поведение middleware ---------------------------------------------------
test('проверенный отзыв (revocation_checked=true) — пропускает', () => {
  const r = run({ role: 'owner', revocation_checked: true });
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.status, null);
});

test('непроверенный отзыв (false) — 503, next не вызван', () => {
  const r = run({ role: 'owner', revocation_checked: false });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'REVOCATION_UNAVAILABLE');
});

test('отсутствие признака (undefined) трактуется как непроверенный — 503', () => {
  const r = run({ role: 'owner' });
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'REVOCATION_UNAVAILABLE');
});

test('отсутствие req.user — 503, а не падение', () => {
  const r = run(undefined);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 503);
  assert.strictEqual(r.code, 'REVOCATION_UNAVAILABLE');
});

// --- Обвязка: middleware реально стоит на необратимых роутах ----------------
function hasRevocationGuard(router, method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `роут ${method.toUpperCase()} ${path} не найден`);
  return layer.route.stack.some(l => l.handle === requireRevocationCheck);
}

const PROTECTED = [
  ['../src/routes/payments',          'post',   '/'],
  ['../src/routes/payments',          'delete', '/:id'],
  ['../src/routes/invoices',          'patch',  '/:id/state'],
  ['../src/routes/outgoingInvoices',  'patch',  '/:id/status'],
  ['../src/routes/outgoingInvoices',  'delete', '/:id'],
  ['../src/routes/billing',           'post',   '/checkout'],
  ['../src/routes/billing',           'post',   '/cancel'],
  ['../src/routes/organizations',     'delete', '/me'],
  ['../src/routes/users',             'patch',  '/me/password'],
];

for (const [mod, method, path] of PROTECTED) {
  test(`requireRevocationCheck навешан на ${method.toUpperCase()} ${path} (${mod.split('/').pop()})`, () => {
    const router = require(mod);
    assert.strictEqual(hasRevocationGuard(router, method, path), true,
      `на ${method.toUpperCase()} ${path} должен стоять requireRevocationCheck`);
  });
}
