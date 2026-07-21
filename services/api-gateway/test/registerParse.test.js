const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const {
  parseCsvRegister, parseExcelRegister, parseAmountToKopecks, normalizeDate, MAX_ROWS,
} = require('../src/lib/registerParse');

test('parseAmountToKopecks: запятая/точка, пробелы-разделители тысяч', () => {
  assert.strictEqual(parseAmountToKopecks('12 345,67'), 1234567);
  assert.strictEqual(parseAmountToKopecks('5000.50'), 500050);
  assert.strictEqual(parseAmountToKopecks(1000), 100000);
  assert.strictEqual(parseAmountToKopecks('abc'), null);
  assert.strictEqual(parseAmountToKopecks(''), null);
  assert.strictEqual(parseAmountToKopecks(null), null);
});

test('normalizeDate: ДД.ММ.ГГГГ и ISO', () => {
  assert.strictEqual(normalizeDate('01.02.2026'), '2026-02-01');
  assert.strictEqual(normalizeDate('2026-02-01'), '2026-02-01');
  assert.strictEqual(normalizeDate(''), null);
  assert.strictEqual(normalizeDate(undefined), null);
});

test('parseCsvRegister: разные варианты заголовков, запятая в сумме', () => {
  const csv = [
    'Номер;Дата;Срок оплаты;Сумма;Покупатель;ИНН;Примечание',
    '101;01.07.2026;15.07.2026;"12 345,67";ООО Ромашка;7707083893;За услуги',
    '102;02.07.2026;16.07.2026;5000.50;ИП Иванов;;',
  ].join('\n');
  const items = parseCsvRegister(Buffer.from(csv, 'utf-8'));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].number, '101');
  assert.strictEqual(items[0].invoice_date, '2026-07-01');
  assert.strictEqual(items[0].due_date, '2026-07-15');
  assert.strictEqual(items[0].amount_kopecks, 1234567);
  assert.strictEqual(items[0].counterparty_name, 'ООО Ромашка');
  assert.strictEqual(items[0].counterparty_inn, '7707083893');
  assert.deepStrictEqual(items[0].warnings, []);

  assert.strictEqual(items[1].amount_kopecks, 500050);
  assert.strictEqual(items[1].counterparty_inn, null);
});

test('parseCsvRegister: невалидный ИНН -> warning, строка не отбрасывается', () => {
  const csv = [
    'Номер счета;Сумма, руб.;Наименование;ИНН',
    '1;1000;ООО Тест;1234567890',
  ].join('\n');
  const items = parseCsvRegister(Buffer.from(csv, 'utf-8'));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].counterparty_inn, '1234567890');
  assert.ok(items[0].warnings.includes('ИНН не прошёл проверку контрольной суммы — проверьте вручную'));
});

test('parseCsvRegister: отсутствующая/нераспознанная сумма -> warning, amount_kopecks null', () => {
  const csv = [
    'Номер;Сумма',
    '1;не число',
    '2;',
  ].join('\n');
  const items = parseCsvRegister(Buffer.from(csv, 'utf-8'));
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].amount_kopecks, null);
  assert.ok(items[0].warnings.includes('Не удалось распознать сумму'));
  assert.strictEqual(items[1].amount_kopecks, null);
});

test('parseCsvRegister: лимит строк', () => {
  const header = 'Номер;Сумма\n';
  const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `${i};100`).join('\n');
  assert.throws(() => parseCsvRegister(Buffer.from(header + rows, 'utf-8')), /максимум/);
});

test('parseCsvRegister: строка нумерации совпадает с реальным номером строки в файле', () => {
  const csv = [
    'Номер;Сумма',
    '1;100',
    '2;200',
  ].join('\n');
  const items = parseCsvRegister(Buffer.from(csv, 'utf-8'));
  assert.strictEqual(items[0].row, 2);
  assert.strictEqual(items[1].row, 3);
});

async function buildWorkbookBuffer(headers, rows) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet('Реестр');
  sheet.addRow(headers);
  for (const r of rows) sheet.addRow(r);
  return wb.xlsx.writeBuffer();
}

test('parseExcelRegister: базовый разбор с разными заголовками и числовыми/датными ячейками', async () => {
  const buf = await buildWorkbookBuffer(
    ['№', 'Дата счёта', 'Оплатить до', 'Итого', 'Заказчик', 'ИНН', 'Назначение'],
    [
      ['101', new Date('2026-07-01'), '15.07.2026', 12345.67, 'ООО Ромашка', '7707083893', 'За услуги'],
    ]
  );
  const items = await parseExcelRegister(buf);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].number, '101');
  assert.strictEqual(items[0].invoice_date, '2026-07-01');
  assert.strictEqual(items[0].due_date, '2026-07-15');
  assert.strictEqual(items[0].amount_kopecks, 1234567);
  assert.strictEqual(items[0].counterparty_name, 'ООО Ромашка');
  assert.deepStrictEqual(items[0].warnings, []);
});

test('parseExcelRegister: невалидный ИНН -> warning, пустые строки пропускаются', async () => {
  const buf = await buildWorkbookBuffer(
    ['Номер', 'Сумма', 'ИНН'],
    [
      ['1', 1000, '1234567890'],
      [null, null, null],
      ['2', 2000, ''],
    ]
  );
  const items = await parseExcelRegister(buf);
  assert.strictEqual(items.length, 2);
  assert.ok(items[0].warnings.includes('ИНН не прошёл проверку контрольной суммы — проверьте вручную'));
  assert.strictEqual(items[1].counterparty_inn, null);
});

test('parseExcelRegister: сумма не распознана -> warning вместо ошибки', async () => {
  const buf = await buildWorkbookBuffer(
    ['Номер', 'Сумма'],
    [['1', 'не число']]
  );
  const items = await parseExcelRegister(buf);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].amount_kopecks, null);
  assert.ok(items[0].warnings.includes('Не удалось распознать сумму'));
});
