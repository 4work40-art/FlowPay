const { test } = require('node:test');
const assert = require('node:assert');
const { PLANS, PURCHASABLE_PLANS } = require('../src/lib/plans');

// Регрессия: единый источник тарифов (lib/plans.js) используется и
// GET /billing/subscription (плейн-план для организаций без строки в
// subscriptions), и PATCH /admin/organizations/:id (назначение тарифа
// админом), и POST /invoices (invoice_limit) — все они читают PLANS из
// этого модуля, а не хранят собственные копии лимитов/цен. Полноценная
// регрессия на уровне маршрутов требует интеграционной тестовой БД
// (см. отчёт) — здесь фиксируем инварианты самого источника данных.

test('PLANS: содержит все ожидаемые тарифы с обязательными полями', () => {
  for (const key of ['free', 'pro', 'business', 'enterprise']) {
    assert.ok(PLANS[key], `тариф ${key} должен существовать`);
    assert.ok('invoice_limit' in PLANS[key]);
    assert.ok('price_kopecks' in PLANS[key]);
    assert.strictEqual(typeof PLANS[key].label, 'string');
  }
});

test('PLANS: free — самый дешёвый и с наименьшим лимитом счетов', () => {
  assert.strictEqual(PLANS.free.price_kopecks, 0);
  assert.ok(PLANS.free.invoice_limit < PLANS.pro.invoice_limit);
  assert.ok(PLANS.pro.invoice_limit < PLANS.business.invoice_limit);
});

test('PLANS: enterprise — без лимита счетов и без фиксированной цены (индивидуальные условия)', () => {
  assert.strictEqual(PLANS.enterprise.invoice_limit, null);
  assert.strictEqual(PLANS.enterprise.price_kopecks, null);
});

test('PURCHASABLE_PLANS: содержит только тарифы с самостоятельным чекаутом', () => {
  assert.ok(PURCHASABLE_PLANS.includes('pro'));
  assert.ok(PURCHASABLE_PLANS.includes('business'));
  assert.ok(!PURCHASABLE_PLANS.includes('enterprise'), 'enterprise оформляется не через самостоятельный чекаут');
  assert.ok(!PURCHASABLE_PLANS.includes('free'), 'free не покупается');
  for (const key of PURCHASABLE_PLANS) {
    assert.ok(PLANS[key], `PURCHASABLE_PLANS ссылается на несуществующий тариф ${key}`);
  }
});
