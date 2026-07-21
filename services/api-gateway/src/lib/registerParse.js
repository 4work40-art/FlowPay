// Разбор реестра счетов (массовая выгрузка из 1С/МойСклад/СБИС) — CSV и
// Excel (.xlsx/.xls). Чистые функции без БД — покрыты юнит-тестами
// (test/registerParse.test.js). По аналогии с lib/statementParse.js:
// парсер только читает и валидирует, ничего не сохраняет.

const ExcelJS = require('exceljs');
const { isValidInn } = require('./inn');

const MAX_ROWS = 500;

// Заголовки в реестрах из разных систем называются по-разному —
// сопоставляем по набору синонимов, регистронезависимо, с учётом
// пробелов/ё->е.
const HEADER_SYNONYMS = {
  number: ['№', 'номер', 'номер счета', 'номер счёта', 'счет №', 'счет номер'],
  invoice_date: ['дата', 'дата счета', 'дата счёта'],
  due_date: ['срок оплаты', 'оплатить до', 'дата оплаты'],
  amount_kopecks: ['сумма', 'сумма, руб.', 'сумма руб', 'итого', 'сумма счета', 'сумма счёта'],
  counterparty_name: ['контрагент', 'покупатель', 'заказчик', 'наименование'],
  counterparty_inn: ['инн'],
  notes: ['примечание', 'назначение'],
};

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

// Строит карту { columnIndex(0-based): fieldName } по строке заголовков.
function detectColumns(headerCells) {
  const map = {};
  headerCells.forEach((cell, idx) => {
    const norm = normalizeHeader(cell);
    if (!norm) return;
    for (const [field, synonyms] of Object.entries(HEADER_SYNONYMS)) {
      if (map[field] !== undefined) continue; // первое совпадение выигрывает
      if (synonyms.includes(norm)) { map[field] = idx; break; }
    }
  });
  return map;
}

// Сумма в реестре — в рублях, с запятой или точкой как разделителем
// дробной части и пробелами как разделителем тысяч (напр. "12 345,67").
function parseAmountToKopecks(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= 0) return null;
    return Math.round(raw * 100);
  }
  const normalized = String(raw).trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

// Приводим дату к YYYY-MM-DD. Поддерживаем ДД.ММ.ГГГГ, Date-объекты
// (Excel хранит даты нативно) и уже нормальную ISO-строку.
function normalizeDate(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const str = String(raw).trim();
  if (!str) return null;
  const dmy = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return iso[0].length > 10 ? iso[0].slice(0, 10) : iso[0];
  return str; // не распознали формат — отдаём как есть, пусть решает пользователь
}

function cellToText(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object' && v.text !== undefined) return v.text; // rich text
  if (typeof v === 'object' && v.result !== undefined) return v.result; // formula
  return v;
}

function buildItem(rowIndex, colMap, cells) {
  const get = (field) => (colMap[field] !== undefined ? cells[colMap[field]] : undefined);

  const warnings = [];

  const numberRaw = get('number');
  const number = numberRaw !== undefined && numberRaw !== null && String(numberRaw).trim() !== ''
    ? String(numberRaw).trim() : null;

  const invoice_date = normalizeDate(get('invoice_date'));
  const due_date = normalizeDate(get('due_date'));

  const amountRaw = get('amount_kopecks');
  const amount_kopecks = parseAmountToKopecks(amountRaw);
  if (amount_kopecks === null) warnings.push('Не удалось распознать сумму');

  const counterpartyNameRaw = get('counterparty_name');
  const counterparty_name = counterpartyNameRaw !== undefined && String(counterpartyNameRaw).trim() !== ''
    ? String(counterpartyNameRaw).trim() : null;

  const innRaw = get('counterparty_inn');
  const counterparty_inn = innRaw !== undefined && String(innRaw).trim() !== ''
    ? String(innRaw).trim() : null;
  if (counterparty_inn && !isValidInn(counterparty_inn)) {
    warnings.push('ИНН не прошёл проверку контрольной суммы — проверьте вручную');
  }

  const notesRaw = get('notes');
  const notes = notesRaw !== undefined && String(notesRaw).trim() !== '' ? String(notesRaw).trim() : null;

  return {
    row: rowIndex,
    number,
    invoice_date,
    due_date,
    amount_kopecks,
    counterparty_name,
    counterparty_inn,
    notes,
    warnings,
  };
}

// text — уже декодированный CSV-текст (см. decodeStatement в statementParse.js
// для похожей задачи с кодировками — здесь предполагаем, что вызывающий
// код при необходимости декодирует буфер сам).
function parseCsvRegister(buffer) {
  const text = buffer.toString('utf-8');
  const lines = text.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (!lines.length) throw new Error('Файл пуст');

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const splitLine = (line) => {
    // Простой сплит с поддержкой кавычек вокруг ячеек.
    const cells = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === delimiter && !inQuotes) { cells.push(cur); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur);
    return cells.map(c => c.trim());
  };

  const rows = lines.map(splitLine);
  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`Реестр слишком велик: максимум ${MAX_ROWS} строк данных (без заголовка)`);
  }

  const colMap = detectColumns(rows[0]);
  const dataRows = rows.slice(1);

  return dataRows.map((cells, idx) => buildItem(idx + 2, colMap, cells)); // +2: строка 1 — заголовок, нумерация с 1
}

async function parseExcelRegister(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('В файле нет листов с данными');

  const rowCount = sheet.actualRowCount || sheet.rowCount;
  if (rowCount - 1 > MAX_ROWS) {
    throw new Error(`Реестр слишком велик: максимум ${MAX_ROWS} строк данных (без заголовка)`);
  }

  const headerRow = sheet.getRow(1);
  const headerCells = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headerCells[colNumber - 1] = cellToText(cell.value);
  });
  const colMap = detectColumns(headerCells);

  const items = [];
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    if (row.cellCount === 0) continue;
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cells[colNumber - 1] = cellToText(cell.value);
    });
    if (!cells.some(c => c !== undefined && c !== null && String(c).trim() !== '')) continue; // пустая строка
    items.push(buildItem(r, colMap, cells));
  }

  return items;
}

module.exports = {
  MAX_ROWS,
  parseCsvRegister,
  parseExcelRegister,
  parseAmountToKopecks,
  normalizeDate,
  detectColumns,
};
