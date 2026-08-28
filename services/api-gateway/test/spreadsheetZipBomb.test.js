// ===========================================================================
// Защита разбора .xlsx от «zip-бомбы» (lib/spreadsheetReader.js).
//
// .xlsx — это ZIP-архив. multer ограничивает лишь СЖАТЫЙ размер загрузки, но
// злонамеренный файл в 5–15 МБ при сжатии 1000:1 разворачивается в гигабайты
// и выбивает память ещё на workbook.xlsx.load(). Поэтому до загрузки мы
// суммируем РАСПАКОВАННЫЙ размер записей по метаданным центрального каталога
// ZIP (не декомпрессируя) и отклоняем подозрительный файл.
//
// Тест конструирует минимальные валидные структуры ZIP (запись центрального
// каталога + EOCD) с нужным объявленным размером и проверяет, что страж
// срабатывает, а на нормальном размере — пропускает (и файл дальше отклоняет
// уже сам ExcelJS общим сообщением, а не сообщением про распакованный размер).
// ===========================================================================
const { test } = require('node:test');
const assert = require('node:assert');
const { assertNotZipBomb, readSheetRows, MAX_ZIP_ENTRIES } = require('../src/lib/spreadsheetReader');

// Минимальный ZIP: [запись центрального каталога][EOCD]. Страж читает EOCD
// (число записей, смещение каталога) и распакованный размер из записи.
function buildZip(uncompSize, entries = 1) {
  const name = Buffer.from('xl/sheet.bin');
  const cd = Buffer.alloc(46 + name.length);
  cd.writeUInt32LE(0x02014b50, 0);   // сигнатура записи центрального каталога
  cd.writeUInt32LE(uncompSize >>> 0, 24); // распакованный размер
  cd.writeUInt16LE(name.length, 28); // длина имени
  name.copy(cd, 46);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // сигнатура EOCD
  eocd.writeUInt16LE(entries, 8);    // записей на этом диске
  eocd.writeUInt16LE(entries, 10);   // всего записей
  eocd.writeUInt32LE(cd.length, 12); // размер центрального каталога
  eocd.writeUInt32LE(0, 16);         // смещение каталога = 0 (каталог в начале буфера)

  return Buffer.concat([cd, eocd]);
}

// Только EOCD с раздутым числом записей (для проверки лимита записей).
function buildEocdWithEntries(entries) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries, 8);
  eocd.writeUInt16LE(entries, 10);
  eocd.writeUInt32LE(0, 12);
  eocd.writeUInt32LE(0, 16);
  return eocd;
}

test('zip-бомба: огромный распакованный размер отклоняется', () => {
  const buf = buildZip(0xFFFFFF00); // ~4.29 ГБ в одной записи
  assert.throws(() => assertNotZipBomb(buf), /распакованном|велик/i);
});

test('zip-бомба: ZIP64-маркер размера (0xFFFFFFFF) отклоняется', () => {
  const buf = buildZip(0xFFFFFFFF);
  assert.throws(() => assertNotZipBomb(buf), /ZIP64|неизвестн/i);
});

test('zip-бомба: подозрительно много записей отклоняется', () => {
  const buf = buildEocdWithEntries(MAX_ZIP_ENTRIES + 1);
  assert.throws(() => assertNotZipBomb(buf), /записей/i);
});

test('нормальный распакованный размер стражем не отклоняется', () => {
  // 50 КБ — обычный размер; страж молчит (файл не zip-бомба).
  assert.doesNotThrow(() => assertNotZipBomb(buildZip(50 * 1024)));
});

test('не-ZIP (не PK) страж пропускает', () => {
  assert.doesNotThrow(() => assertNotZipBomb(Buffer.from('это просто текст, а не архив')));
});

test('readSheetRows: на нормальном размере не подменяет — до ExcelJS доходит (общее сообщение, НЕ про распакованный размер)', async () => {
  // Валидные ZIP-метаданные с нормальным размером, но это не настоящий .xlsx —
  // страж пропускает, а ExcelJS не может прочитать → общее сообщение.
  await assert.rejects(
    () => readSheetRows(buildZip(50 * 1024)),
    (e) => /Не удалось прочитать файл как современный Excel/i.test(e.message)
             && !/распакованном/i.test(e.message)
  );
});
