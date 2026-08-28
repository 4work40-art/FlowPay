// ===========================================================================
// Enforce карты прав PERMISSIONS (routes/users.js) на мутирующих роутах.
//
// Проверяемое свойство: запись в счета, платежи и контрагентов доступна
// ТОЛЬКО ролям owner и accountant. Раньше карта прав отдавалась только
// фронту и нигде не enforce-илась — пользователь с ролью readonly или
// vendor_admin мог создавать/удалять счета и платежи, править контрагентов.
//
// Тестируем сам middleware requireRole в изоляции (юнит-уровень, без
// поднятия БД/сервера): что owner и accountant проходят (next вызывается),
// а readonly и vendor_admin отсекаются на входе (403 FORBIDDEN, next не
// вызывается). Именно этот middleware стоит вторым на всех мутирующих
// роутах invoices/payments/counterparties.
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');

process.env.JWT_SECRET = 'test-secret-value-for-unit-tests-32+chars';

// Заглушаем lib/db до загрузки lib/auth, как это делают другие юнит-тесты
// (см. platformAuthSeparation.test.js): иначе загрузка auth потянет за собой
// реальные pg Pool и ioredis, открытые хендлы которых не дадут процессу
// теста завершиться. Сам requireRole к БД/Redis не обращается — пустых
// заглушек достаточно.
const dbPath = require.resolve('../src/lib/db');
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: { pool: {}, redis: {} },
};

const { requireRole } = require('../src/lib/auth');

function makeRes() {
  return {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

// Прогоняет middleware с заданной ролью и возвращает исход: вызван ли next
// и, если нет, чем ответил res.
function run(middleware, role) {
  const req = role === undefined ? {} : { user: { role } };
  const res = makeRes();
  let passed = false;
  middleware(req, res, () => { passed = true; });
  return { allowed: passed, status: passed ? 200 : res.statusCode, code: res.body?.error?.code, res };
}

// Ровно тот фильтр записи, что стоит на мутирующих роутах invoices/
// payments/counterparties.
const canWrite = requireRole('owner', 'accountant');

// ---------------------------------------------------------------------------
// Разрешённые роли проходят.
// ---------------------------------------------------------------------------

test('owner проходит фильтр записи (next вызван)', () => {
  const r = run(canWrite, 'owner');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.res.statusCode, null, 'res не должен отвечать, когда доступ разрешён');
});

test('accountant проходит фильтр записи (next вызван)', () => {
  const r = run(canWrite, 'accountant');
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.res.statusCode, null);
});

// ---------------------------------------------------------------------------
// Роли только для чтения отсекаются на входе.
// ---------------------------------------------------------------------------

test('readonly отсекается: 403 FORBIDDEN, next не вызван', () => {
  const r = run(canWrite, 'readonly');
  assert.strictEqual(r.allowed, false, 'readonly не должен писать в финансовые данные');
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.code, 'FORBIDDEN');
});

test('vendor_admin отсекается: 403 FORBIDDEN, next не вызван', () => {
  const r = run(canWrite, 'vendor_admin');
  assert.strictEqual(r.allowed, false, 'vendor:admin — отдельная вендорская функция, к записи счетов/платежей отношения не имеет');
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.code, 'FORBIDDEN');
});

// ---------------------------------------------------------------------------
// Граничные случаи: неизвестная роль и отсутствие req.user.
// ---------------------------------------------------------------------------

test('неизвестная роль отсекается (fail-closed)', () => {
  const r = run(canWrite, 'some_future_role');
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.code, 'FORBIDDEN');
});

test('отсутствие req.user (middleware поставлен без authMiddleware) — 403, а не падение', () => {
  const r = run(canWrite, undefined);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.code, 'FORBIDDEN');
});

// ---------------------------------------------------------------------------
// Фабрика уважает переданный список ролей (не захардкожена).
// ---------------------------------------------------------------------------

test('requireRole уважает произвольный список допустимых ролей', () => {
  const ownerOnly = requireRole('owner');
  assert.strictEqual(run(ownerOnly, 'owner').allowed, true);
  assert.strictEqual(run(ownerOnly, 'accountant').allowed, false);
  assert.strictEqual(run(ownerOnly, 'accountant').status, 403);
});
