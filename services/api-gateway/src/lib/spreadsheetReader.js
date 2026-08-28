// Чтение Excel в единый вид: массив строк-массивов ячеек. Общий слой для
// lib/registerParse.js (табличный реестр) и lib/documentRecognizer.js
// (одиночный документ, распознаваемый как счёт/платёжка). Принимается только
// современный .xlsx (OOXML) — устаревший бинарный .xls отклоняется (см. ниже).
const ExcelJS = require('exceljs');

// Лимиты защиты от «zip-бомбы» и раздутых таблиц. multer ограничивает лишь
// СЖАТЫЙ размер загрузки (5–15 МБ), но .xlsx — это ZIP, и при коэффициенте
// сжатия 1000:1 такой файл разворачивается в гигабайты и выбивает память ещё
// на этапе workbook.xlsx.load(). Поэтому до загрузки проверяем суммарный
// РАСПАКОВАННЫЙ размер по метаданным ZIP, а при чтении строк держим потолок
// на их число.
const MAX_UNCOMPRESSED = 100 * 1024 * 1024; // 100 МБ суммарно распакованных данных
const MAX_ZIP_ENTRIES  = 2000;              // у обычного .xlsx записей десятки
const MAX_ROWS_READ    = 200000;            // потолок строк на лист

// Ошибка с понятным пользователю текстом, которую НЕ нужно подменять общим
// сообщением «не удалось прочитать файл» (см. readSheetRows): помечаем флагом.
function userSafeError(message) {
  const e = new Error(message);
  e.userSafe = true;
  return e;
}

function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.text !== undefined) return v.text; // rich text
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  return v;
}

// Проверка на «zip-бомбу» без распаковки. .xlsx — это ZIP: его центральный
// каталог хранит РАСПАКОВАННЫЙ размер каждой записи, и мы суммируем его по
// метаданным, ничего не декомпрессируя. Не-ZIP (в т.ч. старый .xls OLE2) сюда
// не относится — такой файл дальше отклонит ExcelJS.
function assertNotZipBomb(buffer) {
  if (buffer.length < 22 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) return; // не 'PK' — не ZIP

  // Ищем End Of Central Directory (сигнатура PK\x05\x06) с конца буфера
  // (после него может быть комментарий до 65535 байт).
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  const minPos = Math.max(0, buffer.length - (22 + 65535));
  for (let i = buffer.length - 22; i >= minPos; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd === -1) return; // не нашли EOCD — пусть разбирается ExcelJS

  const entries = buffer.readUInt16LE(eocd + 10);
  if (entries > MAX_ZIP_ENTRIES)
    throw userSafeError('Файл Excel отклонён: подозрительно много внутренних записей.');
  const cdOffset = buffer.readUInt32LE(eocd + 16);

  const CD_SIG = 0x02014b50;
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CD_SIG) break;
    const uncomp = buffer.readUInt32LE(p + 24);
    // 0xFFFFFFFF означает ZIP64 (реальный размер в extra-поле) — легитимному
    // счёту/реестру это не нужно; трактуем как подозрительное и отклоняем.
    if (uncomp === 0xffffffff)
      throw userSafeError('Файл Excel отклонён: неизвестный размер внутренней записи (ZIP64).');
    total += uncomp;
    if (total > MAX_UNCOMPRESSED)
      throw userSafeError('Файл Excel слишком велик в распакованном виде — оставьте только нужные листы/строки и загрузите снова.');
    const nameLen    = buffer.readUInt16LE(p + 28);
    const extraLen   = buffer.readUInt16LE(p + 30);
    const commentLen = buffer.readUInt16LE(p + 32);
    p += 46 + nameLen + extraLen + commentLen;
  }
}

// ExcelJS понимает только современный формат (OOXML .xlsx), но делает это
// лучше всего для него (даты, формулы, rich text) — основной путь.
async function readRowsWithExcelJs(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('В файле нет листов с данными');

  const rows = [];
  const rowNumbers = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rows.length >= MAX_ROWS_READ)
      throw userSafeError(`Слишком много строк в файле (более ${MAX_ROWS_READ}). Разбейте данные на части и загрузите снова.`);
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellToText(cell.value);
    });
    rows.push(cells);
    rowNumbers.push(rowNumber);
  });
  return { rows, rowNumbers };
}

// Устаревший бинарный формат (Excel 97-2003, OLE2/BIFF) ExcelJS не читает.
// Раньше здесь стоял fallback на SheetJS (npm-пакет `xlsx`), но его последняя
// опубликованная в npm версия (0.18.5) несёт две неустранённые уязвимости —
// prototype pollution (CVE-2023-30533) и ReDoS (CVE-2024-22363), а патчи
// распространяются только через CDN SheetJS, а не через npm/lockfile. Держать
// уязвимую библиотеку в дереве прод-зависимостей ради разбора устаревшего
// бинарного .xls неоправданно: современные выгрузки (1С/МойСклад/СБИС) — уже
// .xlsx, а бинарный .xls пользователь может пересохранить как .xlsx/.csv за
// пару кликов. Поэтому зависимость убрана, а такой файл теперь честно
// отклоняется с понятной инструкцией вместо тихого разбора уязвимым парсером.
async function readSheetRows(buffer) {
  // Проверка на zip-бомбу — ДО try/catch: её понятное сообщение не должно
  // подменяться общим «не удалось прочитать файл».
  assertNotZipBomb(buffer);
  try {
    return await readRowsWithExcelJs(buffer);
  } catch (excelJsError) {
    // Наши собственные понятные ошибки (лимит строк и т.п.) пробрасываем как есть.
    if (excelJsError && excelJsError.userSafe) throw excelJsError;
    throw new Error(
      'Не удалось прочитать файл как современный Excel (.xlsx). Если это старый бинарный ' +
      '.xls (Excel 97-2003), откройте его в Excel/LibreOffice и сохраните как .xlsx или .csv, ' +
      'затем загрузите снова. Если файл уже .xlsx — проверьте, что он не повреждён.'
    );
  }
}

module.exports = { readSheetRows, assertNotZipBomb, MAX_UNCOMPRESSED, MAX_ZIP_ENTRIES, MAX_ROWS_READ };
