const { test } = require('node:test');
const assert = require('node:assert');
const { isValidInn, isValidKpp, validateRequisites } = require('../src/lib/inn');

test('ИНН юрлица (10 цифр): контрольная сумма', () => {
  assert.ok(isValidInn('7707083893'));   // Сбербанк
  assert.ok(!isValidInn('7707083894'));  // испорченная контрольная цифра
});

test('ИНН ИП/физлица (12 цифр): две контрольные суммы', () => {
  assert.ok(isValidInn('500100732259'));
  assert.ok(!isValidInn('500100732258'));
});

test('ИНН: неверная длина и мусор отклоняются', () => {
  assert.ok(!isValidInn('123'));
  assert.ok(!isValidInn('77070838931'));
  assert.ok(!isValidInn('abcdefghij'));
});

test('КПП: формат ФНС', () => {
  assert.ok(isValidKpp('773601001'));
  assert.ok(!isValidKpp('12345'));
});

test('validateRequisites: пустые значения допустимы', () => {
  assert.strictEqual(validateRequisites({}), null);
  assert.strictEqual(validateRequisites({ inn: '', kpp: null }), null);
  assert.ok(validateRequisites({ inn: '123' }));
});
