const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const {
  parseCsvRegister, parseExcelRegister, parseAmountToKopecks, normalizeDate, pickHeaderRow, MAX_ROWS,
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

test('parseExcelRegister: строка-заголовок документа перед настоящей шапкой таблицы не путается с ней', async () => {
  const buf = await buildWorkbookBuffer(
    ['Реестр счетов на оплату за июль 2026'],
    [
      [],
      ['Номер счёта', 'Сумма, руб.', 'Контрагент'],
      ['301', '50000', 'ООО Тюльпан'],
    ]
  );
  const items = await parseExcelRegister(buf);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].number, '301');
  assert.strictEqual(items[0].amount_kopecks, 5000000);
  assert.strictEqual(items[0].counterparty_name, 'ООО Тюльпан');
});

// Устаревший бинарный .xls (Excel 97-2003, OLE2/BIFF) ExcelJS прочитать не
// может (понимает только OOXML/.xlsx). Раньше здесь стоял SheetJS-фолбэк
// (npm-пакет `xlsx`), но его последняя опубликованная в npm версия 0.18.5
// несёт неустранённые уязвимости (prototype pollution CVE-2023-30533, ReDoS
// CVE-2024-22363), а патчи есть только на CDN вне npm — держать её в дереве
// прод-зависимостей ради разбора устаревшего формата неоправданно (см.
// lib/spreadsheetReader.js). Поэтому такой файл теперь честно отклоняется с
// понятной инструкцией пересохранить его как .xlsx/.csv, а не разбирается
// уязвимым парсером и не падает с невнятной ошибкой нижнего уровня.
test('parseExcelRegister: устаревший бинарный .xls (OLE2/BIFF) отклоняется с понятной инструкцией', async () => {
  // Минимальный буфер с сигнатурой OLE2 (d0cf11e0) — ExcelJS его не читает.
  const ole2 = Buffer.from('d0cf11e0a1b11ae1' + '00'.repeat(24), 'hex');
  assert.strictEqual(ole2.slice(0, 4).toString('hex'), 'd0cf11e0'); // тест честный: это действительно OLE2
  await assert.rejects(
    () => parseExcelRegister(ole2),
    /сохраните как \.xlsx или \.csv/i,
    'ожидалась ошибка с инструкцией пересохранить файл как .xlsx или .csv'
  );
});

test('parseExcelRegister: произвольный байтовый мусор отклоняется понятной ошибкой, а не падает невнятно', async () => {
  await assert.rejects(
    () => parseExcelRegister(Buffer.from('это не Excel и не OLE2, просто текст')),
    /сохраните как \.xlsx или \.csv/i
  );
});

test('pickHeaderRow: выбирает строку с наибольшим числом распознанных колонок', () => {
  const rows = [
    ['Реестр счетов'],
    [],
    ['Номер', 'Сумма', 'ИНН'],
  ];
  const { idx, score } = pickHeaderRow(rows);
  assert.strictEqual(idx, 2);
  assert.strictEqual(score, 3);
});
