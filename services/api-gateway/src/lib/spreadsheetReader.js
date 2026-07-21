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

// Фолбэк на устаревший бинарный формат (Excel 97-2003, OLE2/BIFF) — такие
// файлы по-прежнему реально приходят из 1С и старых версий бухгалтерских
// программ несмотря на расширение .xls, и ExcelJS их не читает вообще.
// SheetJS — единственная поддерживаемая npm-библиотека, читающая оба
// формата; используется только как fallback именно для этого случая.
function readRowsWithSheetJs(buffer) {
  const XLSX = require('xlsx');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('В файле нет листов с данными');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
  return { rows, rowNumbers: rows.map((_, i) => i + 1) };
}

async function readSheetRows(buffer) {
  try {
    return await readRowsWithExcelJs(buffer);
  } catch (excelJsError) {
    try {
      return readRowsWithSheetJs(buffer);
    } catch (sheetJsError) {
      throw new Error(
        'Не удалось прочитать файл ни как современный (.xlsx), ни как старый (.xls) формат Excel — ' +
        'проверьте, что файл не повреждён, либо сохраните его как .xlsx или .csv и загрузите снова.'
      );
    }
  }
}

module.exports = { readSheetRows };
