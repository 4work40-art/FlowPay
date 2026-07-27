const test = require('node:test');
const assert = require('node:assert/strict');
const { calcAmountKopecks, calcTotals } = require('../src/lib/outgoingInvoiceCalc');

test('calcAmountKopecks: количество * цена, округление', () => {
  assert.equal(calcAmountKopecks(3, 10000), 30000);
  assert.equal(calcAmountKopecks(1.5, 10000), 15000);
});

test('calcTotals: без НДС — vat_kopecks = 0', () => {
  const items = [{ quantity: 2, unit_price_kopecks: 50000 }];
  assert.deepStrictEqual(calcTotals(items, 'none', 0), { amount_kopecks: 100000, vat_kopecks: 0 });
});

test('calcTotals: НДС "в том числе" по ставке 20%', () => {
  const items = [{ quantity: 1, unit_price_kopecks: 120000 }]; // 1200 руб. с НДС 20%
  const { amount_kopecks, vat_kopecks } = calcTotals(items, 'rate', 20);
  assert.equal(amount_kopecks, 120000);
  assert.equal(vat_kopecks, 20000); // 200 руб. НДС
});

test('calcTotals: НДС по ставке 22% (актуальная с 2026 года)', () => {
  const items = [{ quantity: 1, unit_price_kopecks: 12200000 }]; // 122000 руб. с НДС 22%
  const { vat_kopecks } = calcTotals(items, 'rate', 22);
  assert.equal(vat_kopecks, 2200000); // 22000 руб. НДС
});

test('calcTotals: сумма по нескольким позициям', () => {
  const items = [
    { quantity: 2, unit_price_kopecks: 10000 },
    { quantity: 3, unit_price_kopecks: 5000 },
  ];
  assert.deepStrictEqual(calcTotals(items, 'none', 0), { amount_kopecks: 35000, vat_kopecks: 0 });
});
