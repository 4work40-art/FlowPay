const { test } = require('node:test');
const assert = require('node:assert');
const {
  parseCsv, is1CFormat, parse1C, decodeStatement,
  parseAmountToKopecks, purposeContainsNumber,
} = require('../src/lib/statementParse');

test('parseCsv: разделитель ; и кавычки', () => {
  const rows = parseCsv('2026-07-10;10000,00;"Оплата по счету 104"\n2026-07-11;5000.50;Счет 1');
  assert.deepStrictEqual(rows[0], ['2026-07-10', '10000,00', 'Оплата по счету 104']);
  assert.strictEqual(rows.length, 2);
});

test('parseAmountToKopecks: запятая, пробелы, отказ на мусор', () => {
  assert.strictEqual(parseAmountToKopecks('10 000,50'), 1000050);
  assert.strictEqual(parseAmountToKopecks('5000.00'), 500000);
  assert.strictEqual(parseAmountToKopecks('abc'), null);
  assert.strictEqual(parseAmountToKopecks('-5'), null);
  assert.strictEqual(parseAmountToKopecks('0'), null);
});

test('purposeContainsNumber: точное совпадение токена, не подстрока', () => {
  assert.ok(!purposeContainsNumber('оплата по счету 104', '1'));
  assert.ok(purposeContainsNumber('оплата по счету 104', '104'));
  assert.ok(purposeContainsNumber('счет №1 от 01.02', '1'));
  assert.ok(purposeContainsNumber('оплата INV-7', 'INV-7'));
  assert.ok(!purposeContainsNumber('оплата INV-77', 'INV-7'));
});

test('parse1C: разбор секций документов', () => {
  const text = [
    '1CClientBankExchange',
    'ВерсияФормата=1.02',
    'СекцияДокумент=Платежное поручение',
    'Номер=55',
    'Дата=10.07.2026',
    'Сумма=10000.00',
    'НазначениеПлатежа=Оплата по счету 104',
    'КонецДокумента',
    'СекцияДокумент=Платежное поручение',
    'ДатаПоступило=11.07.2026',
    'Дата=09.07.2026',
    'Сумма=5000.00',
    'НазначениеПлатежа=Счет № 1',
    'КонецДокумента',
    'КонецФайла',
  ].join('\n');
  assert.ok(is1CFormat(text));
  const rows = parse1C(text);
  assert.deepStrictEqual(rows, [
    ['2026-07-10', '10000.00', 'Оплата по счету 104'],
    ['2026-07-11', '5000.00', 'Счет № 1'], // ДатаПоступило приоритетнее Даты
  ]);
});

test('decodeStatement: windows-1251 распознаётся', () => {
  // «Сумма» в cp1251
  const cp1251 = Buffer.from([0xd1, 0xf3, 0xec, 0xec, 0xe0]);
  assert.strictEqual(decodeStatement(cp1251), 'Сумма');
  assert.strictEqual(decodeStatement(Buffer.from('Сумма', 'utf-8')), 'Сумма');
});
