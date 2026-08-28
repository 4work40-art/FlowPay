// Чтение Excel в единый вид: массив строк-массивов ячеек. Общий слой для
// lib/registerParse.js (табличный реестр) и lib/documentRecognizer.js
// (одиночный документ, распознаваемый как счёт/платёжка) — оба варианта
// файла бывают и в современном .xlsx, и в устаревшем бинарном .xls.
const ExcelJS = require('exceljs');

function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.text !== undefined) return v.text; // rich text
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  return v;
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
  try {
    return await readRowsWithExcelJs(buffer);
  } catch (excelJsError) {
    throw new Error(
      'Не удалось прочитать файл как современный Excel (.xlsx). Если это старый бинарный ' +
      '.xls (Excel 97-2003), откройте его в Excel/LibreOffice и сохраните как .xlsx или .csv, ' +
      'затем загрузите снова. Если файл уже .xlsx — проверьте, что он не повреждён.'
    );
  }
}

module.exports = { readSheetRows };
