// Разбор реестра счетов (массовая выгрузка из 1С/МойСклад/СБИС) — CSV и
// Excel (.xlsx/.xls). Чистые функции без БД — покрыты юнит-тестами
// (test/registerParse.test.js). По аналогии с lib/statementParse.js:
// парсер только читает и валидирует, ничего не сохраняет.

const { isValidInn } = require('./inn');
const { readSheetRows } = require('./spreadsheetReader');

const MAX_ROWS = 500;
const HEADER_SEARCH_ROWS = 5; // шапка таблицы не всегда в первой строке —
// у реальных выгрузок часто есть строка-заголовок документа перед таблицей
// ("Реестр счетов на оплату"), проверяем первые несколько строк.

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

// Строит карту { fieldName: columnIndex(0-based) } по строке заголовков.
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

// Ищем строку заголовков среди первых нескольких строк файла — берём ту,
// где нашлось больше всего распознанных колонок (при равенстве — более
// раннюю). Так строка-название документа перед настоящей шапкой таблицы
// не принимается за шапку.
function pickHeaderRow(rowsOfCells) {
  let best = { idx: 0, colMap: {}, score: -1 };
  const limit = Math.min(HEADER_SEARCH_ROWS, rowsOfCells.length);
  for (let i = 0; i < limit; i++) {
    const colMap = detectColumns(rowsOfCells[i]);
    const score = Object.keys(colMap).length;
    if (score > best.score) best = { idx: i, colMap, score };
  }
  return best;
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

// Общий конвейер: массив строк-массивов ячеек (как для CSV, так и для
// Excel после чтения любым из движков) -> найти шапку -> собрать элементы.
// rowNumberOf(idx) переводит индекс в массиве в "человеческий" номер строки
// файла (для CSV это idx+1, для Excel — фактический номер строки листа).
function rowsToItems(rows, rowNumberOf) {
  if (!rows.length) return [];
  const header = pickHeaderRow(rows);
  const items = [];
  for (let i = header.idx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || !cells.some(c => c !== undefined && c !== null && String(c).trim() !== '')) continue; // пустая строка
    items.push(buildItem(rowNumberOf(i), header.colMap, cells));
  }
  return items;
}

// Простой сплит CSV-текста в массив строк-ячеек с поддержкой кавычек и
// разделителя ; или , — переиспользуется и одиночным распознаванием
// документа (lib/documentRecognizer.js), когда CSV содержит не реестр,
// а один документ (пусть это и редкий случай для CSV).
function splitCsvToRows(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const delimiter = lines[0].includes(';') ? ';' : ',';
  const splitLine = (line) => {
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
  return lines.map(splitLine);
}

function parseCsvRegister(buffer) {
  const rows = splitCsvToRows(buffer.toString('utf-8'));
  if (!rows.length) throw new Error('Файл пуст');

  if (rows.length - 1 > MAX_ROWS) {
    throw new Error(`Реестр слишком велик: максимум ${MAX_ROWS} строк данных (без заголовка)`);
  }

  return rowsToItems(rows, (idx) => idx + 1); // нумерация строк файла с 1
}

async function parseExcelRegister(buffer) {
  const { rows, rowNumbers } = await readSheetRows(buffer);

  if (rowNumbers.length - 1 > MAX_ROWS) {
    throw new Error(`Реестр слишком велик: максимум ${MAX_ROWS} строк данных (без заголовка)`);
  }

  return rowsToItems(rows, (idx) => rowNumbers[idx]);
}

module.exports = {
  MAX_ROWS,
  parseCsvRegister,
  parseExcelRegister,
  parseAmountToKopecks,
  normalizeDate,
  detectColumns,
  pickHeaderRow,
  splitCsvToRows,
};
