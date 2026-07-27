const test = require('node:test');
const assert = require('node:assert/strict');
const { amountToWordsRu } = require('../src/lib/numberToWordsRu');

test('amountToWordsRu: ноль', () => {
  assert.equal(amountToWordsRu(0), 'Ноль рублей 00 копеек');
});

test('amountToWordsRu: единственное число рубля/копейки', () => {
  assert.equal(amountToWordsRu(100), 'Один рубль 00 копеек');
  assert.equal(amountToWordsRu(1), 'Ноль рублей 01 копейка');
});

test('amountToWordsRu: тысячи (женский род "одна тысяча")', () => {
  assert.equal(amountToWordsRu(150000), 'Одна тысяча пятьсот рублей 00 копеек');
});

test('amountToWordsRu: копейки с окончанием "копейки" (2-4)', () => {
  assert.equal(amountToWordsRu(2123456), 'Двадцать одна тысяча двести тридцать четыре рубля 56 копеек');
});

test('amountToWordsRu: миллионы', () => {
  assert.equal(amountToWordsRu(477600000), 'Четыре миллиона семьсот семьдесят шесть тысяч рублей 00 копеек');
});
