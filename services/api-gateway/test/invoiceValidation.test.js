const { test } = require('node:test');
const assert = require('node:assert');
const { validateInvoiceCreate, validateBulkInvoiceItem } = require('../src/lib/invoiceValidation');

// Регрессия: due_date обязателен при создании счёта (POST /invoices) —
// без него счёт не попадёт в календарь оплат и не будет учтён в просрочках.
test('validateInvoiceCreate: без due_date — ошибка', () => {
  const error = validateInvoiceCreate({ amount_kopecks: 10000, due_date: undefined });
  assert.ok(error, 'ожидалась ошибка валидации');
  assert.match(error, /срок оплаты/i);
});

test('validateInvoiceCreate: due_date пустая строка — тоже ошибка', () => {
  const error = validateInvoiceCreate({ amount_kopecks: 10000, due_date: '' });
  assert.ok(error);
});

test('validateInvoiceCreate: amount_kopecks не указан — ошибка про сумму, а не про дату', () => {
  const error = validateInvoiceCreate({ due_date: '2026-09-01' });
  assert.match(error, /сумма/i);
});

test('validateInvoiceCreate: amount_kopecks не целое число — ошибка', () => {
  const error = validateInvoiceCreate({ amount_kopecks: 100.5, due_date: '2026-09-01' });
  assert.match(error, /целым числом/i);
});

test('validateInvoiceCreate: amount_kopecks <= 0 — ошибка "больше нуля"', () => {
  const errZero = validateInvoiceCreate({ amount_kopecks: 0, due_date: '2026-09-01' });
  const errNeg = validateInvoiceCreate({ amount_kopecks: -500, due_date: '2026-09-01' });
  assert.match(errZero, /больше нуля/i);
  assert.match(errNeg, /больше нуля/i);
});

// Регрессия: NaN (например, из-за мусорного ввода вроде "-500abc" на фронте)
// должен давать отдельное сообщение "указана некорректно", а не вводящее
// в заблуждение "должна быть больше нуля".
test('validateInvoiceCreate: amount_kopecks = NaN — отдельное сообщение "некорректно", не про "больше нуля"', () => {
  const error = validateInvoiceCreate({ amount_kopecks: NaN, due_date: '2026-09-01' });
  assert.match(error, /некорректно/i);
  assert.doesNotMatch(error, /больше нуля/i);
});

test('validateInvoiceCreate: корректные данные — null (нет ошибки)', () => {
  assert.strictEqual(validateInvoiceCreate({ amount_kopecks: 10000, due_date: '2026-09-01' }), null);
});

test('validateInvoiceCreate: пустое тело запроса — не падает, возвращает ошибку', () => {
  assert.ok(validateInvoiceCreate(undefined));
  assert.ok(validateInvoiceCreate(null));
  assert.ok(validateInvoiceCreate({}));
});

// Регрессия: due_date обязателен и при пакетном создании (POST /invoices/bulk) —
// каждая строка реестра проверяется независимо.
test('validateBulkInvoiceItem: без due_date — ошибка про срок оплаты', () => {
  const error = validateBulkInvoiceItem({ amount_kopecks: 10000 });
  assert.ok(error);
  assert.match(error, /срок оплаты/i);
});

test('validateBulkInvoiceItem: некорректная сумма — ошибка про сумму (проверяется раньше due_date)', () => {
  const error = validateBulkInvoiceItem({ amount_kopecks: 0, due_date: '2026-09-01' });
  assert.match(error, /сумм/i);
  const error2 = validateBulkInvoiceItem({ amount_kopecks: 100.5, due_date: '2026-09-01' });
  assert.match(error2, /сумм/i);
});

test('validateBulkInvoiceItem: amount_kopecks = NaN — "некорректно", amount_kopecks = 0 — "больше нуля"', () => {
  const errNaN = validateBulkInvoiceItem({ amount_kopecks: NaN, due_date: '2026-09-01' });
  assert.match(errNaN, /некорректно/i);
  assert.doesNotMatch(errNaN, /больше нуля/i);

  const errZero = validateBulkInvoiceItem({ amount_kopecks: 0, due_date: '2026-09-01' });
  assert.match(errZero, /больше нуля/i);
});

test('validateBulkInvoiceItem: корректная строка — null', () => {
  assert.strictEqual(validateBulkInvoiceItem({ amount_kopecks: 10000, due_date: '2026-09-01' }), null);
});

test('validateBulkInvoiceItem: пустой item — не падает', () => {
  assert.ok(validateBulkInvoiceItem({}));
  assert.ok(validateBulkInvoiceItem(undefined));
});
