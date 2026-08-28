// ===========================================================================
// Wiring-тесты ролевых фильтров на роутах, где их раньше НЕ БЫЛО.
//
// Аудит нашёл два расхождения с картой прав PERMISSIONS (routes/users.js):
//   1) все мутирующие роуты выставленных счетов (routes/outgoingInvoices.js)
//      стояли только под authMiddleware — readonly и vendor_admin могли
//      создавать/править/отменять/удалять выставленные счета;
//   2) чтение журнала аудита (routes/audit.js) стояло только под
//      authMiddleware — accountant и readonly (у которых нет 'audit:read')
//      могли прочитать весь журнал.
//
// Юнит-тест самого requireRole уже есть (roleWriteAuthorization.test.js). Здесь
// проверяем именно ОБВЯЗКУ: что на конкретных роутах ролевой фильтр реально
// стоит вторым в цепочке (сразу после authMiddleware, как во всех остальных
// финансовых роутах) и что он пропускает нужные роли и отсекает остальные.
// Без поднятия БД/сервера: берём стек роута из express-роутера и исполняем
// именно этот (синхронный) слой-фильтр в изоляции.
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-32+chars';

// Заглушаем lib/db до загрузки роутеров (они тянут pool/redis и lib/audit).
const dbPath = require.resolve('../src/lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { pool: { query: async () => ({ rows: [] }), connect: async () => ({}) }, redis: {} },
};

const outgoingRouter = require('../src/routes/outgoingInvoices');
const auditRouter = require('../src/routes/audit');

function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Находит слой роута в express-роутере по методу и пути.
function findRoute(router, method, path) {
  const layer = router.stack.find(l => l.route && l.route.path === path && l.route.methods[method]);
  assert.ok(layer, `роут ${method.toUpperCase()} ${path} не найден в роутере`);
  return layer.route;
}

// Исполняет ровно один (синхронный) middleware-слой с заданной ролью и
// возвращает исход: пропустил ли он запрос дальше (next) или ответил сам.
function runGuard(handler, role) {
  const req = { user: { role, revocation_checked: true } };
  const res = makeRes();
  let passed = false;
  handler(req, res, () => { passed = true; });
  return { allowed: passed, status: res.statusCode, code: res.body?.error?.code };
}

// Ролевой фильтр по соглашению репозитория стоит ВТОРЫМ в цепочке — сразу
// после authMiddleware (index 0). Проверяем именно его.
function roleGuardOf(route) {
  assert.ok(route.stack.length >= 2, 'у роута должен быть authMiddleware + ролевой фильтр');
  return route.stack[1].handle;
}

// --- Выставленные счета: запись только owner/accountant --------------------
const OUTGOING_WRITE_ROUTES = [
  ['post',   '/'],
  ['patch',  '/:id'],
  ['post',   '/:id/items'],
  ['delete', '/:id/items/:itemId'],
  ['patch',  '/:id/status'],
  ['delete', '/:id'],
];

for (const [method, path] of OUTGOING_WRITE_ROUTES) {
  test(`outgoing ${method.toUpperCase()} ${path}: owner/accountant проходят, readonly/vendor_admin — 403`, () => {
    const guard = roleGuardOf(findRoute(outgoingRouter, method, path));
    assert.strictEqual(runGuard(guard, 'owner').allowed, true, 'owner должен проходить');
    assert.strictEqual(runGuard(guard, 'accountant').allowed, true, 'accountant должен проходить');

    const ro = runGuard(guard, 'readonly');
    assert.strictEqual(ro.allowed, false, 'readonly не должен писать выставленные счета');
    assert.strictEqual(ro.status, 403);
    assert.strictEqual(ro.code, 'FORBIDDEN');

    const va = runGuard(guard, 'vendor_admin');
    assert.strictEqual(va.allowed, false, 'vendor_admin не должен писать выставленные счета');
    assert.strictEqual(va.status, 403);
    assert.strictEqual(va.code, 'FORBIDDEN');
  });
}

// --- Журнал аудита: чтение только owner/vendor_admin -----------------------
test('audit GET /logs: owner/vendor_admin проходят, accountant/readonly — 403', () => {
  const guard = roleGuardOf(findRoute(auditRouter, 'get', '/logs'));
  assert.strictEqual(runGuard(guard, 'owner').allowed, true, 'owner имеет audit:read');
  assert.strictEqual(runGuard(guard, 'vendor_admin').allowed, true, 'vendor_admin имеет audit:read');

  for (const role of ['accountant', 'readonly']) {
    const r = runGuard(guard, role);
    assert.strictEqual(r.allowed, false, `${role} не имеет audit:read и не должен читать журнал`);
    assert.strictEqual(r.status, 403);
    assert.strictEqual(r.code, 'FORBIDDEN');
  }
});
