const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeItemName, priceChangePct, peakMonth } = require('../src/lib/itemAnalytics');

test('normalizeItemName: обрезает пробелы, приводит к нижнему регистру, схлопывает пробелы', () => {
  assert.equal(normalizeItemName('  Бумага   А4  '), 'бумага а4');
  assert.equal(normalizeItemName(''), '');
  assert.equal(normalizeItemName(null), '');
});

test('priceChangePct: null при менее чем двух точках с данными', () => {
  assert.equal(priceChangePct([]), null);
  assert.equal(priceChangePct([{ avg_price_kopecks: 100 }]), null);
});

test('priceChangePct: считает изменение между первой и последней точкой', () => {
  const months = [
    { avg_price_kopecks: 1000 },
    { avg_price_kopecks: null },
    { avg_price_kopecks: 1100 },
  ];
  assert.equal(priceChangePct(months), 10);
});

test('priceChangePct: null при нулевой первой цене', () => {
  assert.equal(priceChangePct([{ avg_price_kopecks: 0 }, { avg_price_kopecks: 100 }]), null);
});

test('peakMonth: находит месяц с максимальной суммой', () => {
  const months = [
    { month: '2026-01', total_kopecks: 500 },
    { month: '2026-02', total_kopecks: 1500 },
    { month: '2026-03', total_kopecks: null },
  ];
  assert.equal(peakMonth(months), '2026-02');
  assert.equal(peakMonth([]), null);
});
