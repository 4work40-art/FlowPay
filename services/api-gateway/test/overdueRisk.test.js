const { test } = require('node:test');
const assert = require('node:assert');
const { computeOverdueRisk } = require('../src/lib/overdueRisk');

const today = new Date('2026-08-10');

test('computeOverdueRisk: нет истории — null', () => {
  assert.strictEqual(computeOverdueRisk([], { today }), null);
  assert.strictEqual(computeOverdueRisk([{ due_date: null, paid_date: null }], { today }), null);
});

test('computeOverdueRisk: все счета оплачены вовремя — низкий риск', () => {
  const invoices = Array.from({ length: 5 }, (_, i) => ({
    due_date: `2026-0${i + 1}-10`, paid_date: `2026-0${i + 1}-09`,
  }));
  const risk = computeOverdueRisk(invoices, { today });
  assert.strictEqual(risk.level, 'low');
  assert.strictEqual(risk.overdue_count, 0);
  assert.strictEqual(risk.avg_delay_days, 0);
});

test('computeOverdueRisk: большинство счетов просрочены — высокий риск', () => {
  const invoices = [
    { due_date: '2026-01-01', paid_date: '2026-01-15' }, // +14
    { due_date: '2026-02-01', paid_date: '2026-02-20' }, // +19
    { due_date: '2026-03-01', paid_date: '2026-03-05' }, // +4
    { due_date: '2026-04-01', paid_date: '2026-04-01' }, // 0
    { due_date: '2026-05-01', paid_date: '2026-05-10' }, // +9
  ];
  const risk = computeOverdueRisk(invoices, { today });
  assert.strictEqual(risk.overdue_count, 4);
  assert.strictEqual(risk.level, 'high');
  assert.ok(risk.avg_delay_days > 0);
  assert.ok(risk.explanation.includes('4 из последних 5'));
});

test('computeOverdueRisk: неоплаченный просроченный счёт считается по сегодняшней дате', () => {
  const invoices = [{ due_date: '2026-07-01', paid_date: null }]; // 40 дней просрочки к today
  const risk = computeOverdueRisk(invoices, { today });
  assert.strictEqual(risk.overdue_count, 1);
  assert.strictEqual(risk.avg_delay_days, 40);
  assert.strictEqual(risk.level, 'high');
});

test('computeOverdueRisk: берёт только последние sampleSize счетов', () => {
  const early = Array.from({ length: 5 }, (_, i) => ({ due_date: `2025-0${i + 1}-01`, paid_date: `2025-0${i + 1}-20` })); // сильно просрочены, старые
  const recent = Array.from({ length: 5 }, (_, i) => ({ due_date: `2026-0${i + 1}-01`, paid_date: `2026-0${i + 1}-01` })); // все вовремя, свежие
  const risk = computeOverdueRisk([...early, ...recent], { today, sampleSize: 5 });
  assert.strictEqual(risk.sample_size, 5);
  assert.strictEqual(risk.overdue_count, 0);
  assert.strictEqual(risk.level, 'low');
});

test('computeOverdueRisk: тренд worsening при ухудшении последних трёх платежей', () => {
  const invoices = [
    { due_date: '2026-01-01', paid_date: '2026-01-01' }, // 0
    { due_date: '2026-02-01', paid_date: '2026-02-01' }, // 0
    { due_date: '2026-03-01', paid_date: '2026-03-01' }, // 0
    { due_date: '2026-04-01', paid_date: '2026-04-10' }, // +9
    { due_date: '2026-05-01', paid_date: '2026-05-12' }, // +11
    { due_date: '2026-06-01', paid_date: '2026-06-15' }, // +14
  ];
  const risk = computeOverdueRisk(invoices, { today });
  assert.strictEqual(risk.trend, 'worsening');
});

test('computeOverdueRisk: тренд не определяется при менее чем 6 счетах', () => {
  const invoices = [
    { due_date: '2026-01-01', paid_date: '2026-01-01' },
    { due_date: '2026-02-01', paid_date: '2026-02-15' },
  ];
  const risk = computeOverdueRisk(invoices, { today });
  assert.strictEqual(risk.trend, null);
});

test('computeOverdueRisk: граница risk-уровней (ровно 20% и 50%)', () => {
  const mk = (delays) => delays.map((d, i) => ({
    due_date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    paid_date: d === 0 ? `2026-01-${String(i + 1).padStart(2, '0')}` : `2026-01-${String(i + 1 + d).padStart(2, '0')}`,
  }));
  // 1 из 5 просрочен = 20% -> должно попасть в medium (не < 20%)
  const border20 = computeOverdueRisk(mk([5, 0, 0, 0, 0]), { today });
  assert.strictEqual(border20.level, 'medium');
  // 2 из 5 просрочены = 40% -> medium
  const mid = computeOverdueRisk(mk([5, 5, 0, 0, 0]), { today });
  assert.strictEqual(mid.level, 'medium');
  // 3 из 5 = 60% -> high
  const high = computeOverdueRisk(mk([5, 5, 5, 0, 0]), { today });
  assert.strictEqual(high.level, 'high');
});
