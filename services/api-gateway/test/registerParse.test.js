const { test } = require('node:test');
const assert = require('node:assert');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
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

// Реальные выгрузки из 1С/старых бухгалтерских программ нередко приходят в
// устаревшем бинарном формате (Excel 97-2003, OLE2/BIFF) несмотря на
// расширение .xls — ExcelJS такой файл прочитать не может (понимает только
// OOXML/.xlsx) и раньше это приводило к общей ошибке «не удалось разобрать
// файл» без объяснения причины. Регресс-тест на фолбэк через SheetJS.
test('parseExcelRegister: устаревший бинарный формат .xls (OLE2/BIFF) читается через фолбэк', async () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ['Номер счёта', 'Сумма, руб.', 'Контрагент', 'ИНН'],
    ['300', 134232, 'ООО Ромашка', '7707083893'],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, 'Sheet1');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'biff8' }); // legacy .xls (OLE2)
  assert.strictEqual(buf.slice(0, 4).toString('hex'), 'd0cf11e0'); // сигнатура OLE2 — убеждаемся, что тест честный

  const items = await parseExcelRegister(buf);
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].number, '300');
  assert.strictEqual(items[0].amount_kopecks, 13423200);
  assert.strictEqual(items[0].counterparty_name, 'ООО Ромашка');
  assert.strictEqual(items[0].counterparty_inn, '7707083893');
});

test('parseExcelRegister: произвольный текст не роняет разбор — SheetJS трактует его как таблицу из одной ячейки без данных', async () => {
  // Ни ExcelJS (только OOXML), ни бинарный OLE2-разбор здесь неприменимы;
  // SheetJS в фолбэке достаточно терпим и не бросает исключение на любой
  // байтовый мусор — в этом случае просто не находит строк данных, а не
  // выдаёт первую попавшуюся ошибку с нижнего уровня библиотеки. Итоговое
  // сообщение пользователю «реестр пуст» формирует уже роут-обработчик.
  const items = await parseExcelRegister(Buffer.from('это не Excel и не OLE2, просто текст'));
  assert.deepStrictEqual(items, []);
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
