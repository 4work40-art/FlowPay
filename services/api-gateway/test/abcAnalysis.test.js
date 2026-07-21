const { test } = require('node:test');
const assert = require('node:assert');
const { classifyAbc } = require('../src/lib/abcAnalysis');

test('classifyAbc: пустой список', () => {
  assert.deepStrictEqual(classifyAbc([]), []);
});

test('classifyAbc: один поставщик — всегда группа A', () => {
  const result = classifyAbc([{ id: '1', total_kopecks: 100000 }]);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].group, 'A');
  assert.strictEqual(result[0].share_pct, 100);
  assert.strictEqual(result[0].cumulative_pct, 100);
});

test('classifyAbc: классическое разбиение 80/15/5 по правилу Парето', () => {
  const items = [
    { id: 'big', total_kopecks: 8000 },
    { id: 'mid', total_kopecks: 1500 },
    { id: 'small', total_kopecks: 500 },
  ];
  const result = classifyAbc(items);
  assert.strictEqual(result[0].id, 'big');
  assert.strictEqual(result[0].group, 'A');
  assert.strictEqual(result[0].cumulative_pct, 80);
  assert.strictEqual(result[1].id, 'mid');
  assert.strictEqual(result[1].group, 'B');
  assert.strictEqual(result[1].cumulative_pct, 95);
  assert.strictEqual(result[2].id, 'small');
  assert.strictEqual(result[2].group, 'C');
  assert.strictEqual(result[2].cumulative_pct, 100);
});

test('classifyAbc: результат отсортирован по убыванию суммы независимо от порядка на входе', () => {
  const items = [
    { id: 'small', total_kopecks: 100 },
    { id: 'big', total_kopecks: 900 },
  ];
  const result = classifyAbc(items);
  assert.strictEqual(result[0].id, 'big');
  assert.strictEqual(result[1].id, 'small');
});

test('classifyAbc: нулевой общий объём — не падает, все в C', () => {
  const result = classifyAbc([{ id: '1', total_kopecks: 0 }]);
  assert.strictEqual(result[0].group, 'C');
  assert.strictEqual(result[0].share_pct, 0);
});
