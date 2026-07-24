// Разбор банковских выписок: CSV (дата;сумма;назначение) и
// 1CClientBankExchange (*.txt) — стандартный формат выгрузки банков РФ.
// Чистые функции без БД — покрыты юнит-тестами (test/statementParse.test.js).

// Простой CSV-парсер под формат выписки: дата;сумма;назначение платежа
// (разделитель ; или , — оба часто встречаются у банков РФ). Без внешних
// библиотек — формат намеренно узкий и предсказуемый.
function parseCsv(text) {
  const delimiter = text.includes(';') ? ';' : ',';
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, '')));
}

function is1CFormat(text) {
  return text.slice(0, 200).includes('1CClientBankExchange');
}

// Разбираем секции документов и приводим к тем же строкам
// [дата, сумма, назначение], что и CSV.
function parse1C(text) {
  const rows = [];
  let doc = null;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('СекцияДокумент')) { doc = {}; continue; }
    if (trimmed === 'КонецДокумента') {
      if (doc) {
        // ДД.ММ.ГГГГ -> ГГГГ-ММ-ДД; ДатаПоступило точнее для входящих
        const rawDate = doc['ДатаПоступило'] || doc['Дата'] || '';
        const m = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
        const date = m ? `${m[3]}-${m[2]}-${m[1]}` : rawDate;
        rows.push([date, doc['Сумма'] || '', doc['НазначениеПлатежа'] || '']);
      }
      doc = null;
      continue;
    }
    if (doc !== null) {
      const eq = trimmed.indexOf('=');
      if (eq > 0) doc[trimmed.slice(0, eq)] = trimmed.slice(eq + 1).trim();
    }
  }
  return rows;
}

// Банковские выгрузки часто в windows-1251 — определяем по символам
// замены после utf-8 декодирования.
function decodeStatement(buffer) {
  const utf8 = buffer.toString('utf-8');
  if (!utf8.includes('�')) return utf8;
  try {
    return new TextDecoder('windows-1251').decode(buffer);
  } catch {
    return utf8;
  }
}

// Заголовки выписок сильно различаются между банками РФ (Сбербизнес, Тинькофф,
// Альфа, ВТБ, Точка, Модульбанк и т.д.) — порядок и число колонок не
// стандартизированы, в отличие от 1CClientBankExchange. Вместо жёстких
// индексов ищем колонки по смыслу заголовка и приводим любую раскладку к
// одному виду [дата, сумма, назначение], которым дальше пользуется импорт.
// Если поступление/списание разнесены по отдельным колонкам («Дебет»/«Кредит»,
// «Приход»/«Расход»), для входящих платежей (нас интересуют оплаты от
// контрагентов) берём колонку поступления, а не любую ненулевую сумму.
// \w не матчит кириллицу в JS-регулярках — используем "." вместо \w* для
// суффиксов кириллических слов (та же ловушка, что и в documentRecognizer.js).
const HEADER_PATTERNS = {
  date: /дата\s*(операц|плат|документ|провод)?/i,
  purpose: /назначен.{0,3}\s*плат|наименован.{0,3}\s*плат|комментар/i,
  credit: /кредит|поступлен|приход|зачислен/i,
  debit: /дебет|списан|расход/i,
  amount: /^сумма/i,
};

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const cells = (rows[i] || []).map(c => String(c ?? '').trim());
    const hasDate = cells.some(c => HEADER_PATTERNS.date.test(c));
    const hasAmount = cells.some(c => HEADER_PATTERNS.amount.test(c) || HEADER_PATTERNS.credit.test(c) || HEADER_PATTERNS.debit.test(c));
    if (hasDate && hasAmount) return i;
  }
  return -1;
}

function cellDate(v) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  const m = s.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

// Приводит строки любой раскладки (CSV или Excel-выписка любого банка РФ) к
// каноническому виду [дата, сумма, назначение]. Если заголовок с
// распознаваемыми колонками не найден — считаем формат уже каноническим
// (устаревшее поведение: дата;сумма;назначение по позиции), для обратной
// совместимости с узким CSV-парсером.
function normalizeStatementRows(rows) {
  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) return rows;

  const header = rows[headerIdx].map(c => String(c ?? '').trim());
  const dateCol = header.findIndex(h => HEADER_PATTERNS.date.test(h));
  const purposeCol = header.findIndex(h => HEADER_PATTERNS.purpose.test(h));
  const creditCol = header.findIndex(h => HEADER_PATTERNS.credit.test(h));
  const debitCol = header.findIndex(h => HEADER_PATTERNS.debit.test(h));
  const amountCol = header.findIndex(h => HEADER_PATTERNS.amount.test(h));
  if (dateCol === -1) return rows;

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    if (!cells || !cells.length) continue;
    const date = cellDate(cells[dateCol]);
    if (!date) continue;

    // Если в файле есть отдельная общая колонка "Сумма" — она надёжнее
    // Дебета/Кредита: у некоторых банков (см. реальные выгрузки) отдельная
    // сумма всегда заполнена, а какая из колонок Дебет/Кредит означает
    // "поступление" — зависит от того, чей это счёт в выписке, и не
    // определяется по одному только названию колонки. Разбираем Дебет/Кредит
    // только когда общей колонки "Сумма" нет — тогда берём сторону с
    // ненулевым значением (для входящего платежа это обычно Кредит).
    let amount = null;
    if (amountCol !== -1) {
      amount = String(cells[amountCol] ?? '').trim();
    } else if (creditCol !== -1) {
      const creditVal = Number(String(cells[creditCol] ?? '').trim().replace(/\s/g, '').replace(',', '.'));
      if (creditVal > 0) amount = String(cells[creditCol]);
      else continue; // это строка списания (Дебет заполнен, Кредит пуст/0) — пропускаем
    } else if (debitCol !== -1) {
      continue; // только списания в файле — нет входящих платежей
    }
    if (!amount) continue;

    const purpose = purposeCol !== -1 ? String(cells[purposeCol] ?? '').trim() : '';
    out.push([date, amount, purpose]);
  }
  return out;
}

function parseAmountToKopecks(raw) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

// Номер счёта должен встречаться в назначении платежа как отдельный токен,
// а не как подстрока: счёт «1» не должен «находиться» в «оплата по счёту 104».
// Границей считаем любой не-буквенно-цифровой символ или край строки.
//
// Для чисто цифровых номеров этого недостаточно: короткий номер вида «5»
// или «1» случайно совпадает как «отдельный токен» внутри самой суммы
// платежа — с пробелом-разделителем тысяч («5 812,67» — «5» окружено
// пробелом и пробелом/цифрой) или с дробной частью после точки («1793.5»).
// Это и приводило к тому, что совершенно не связанные платежи (эквайринг,
// счета других контрагентов) ошибочно приписывались чужому счёту. Поэтому
// чисто цифровой номер засчитываем только рядом со словом «счёт»/«счёту» —
// тем же якорем, что уже требует findReferencedInvoiceNumber в
// documentRecognizer.js при разборе одной платёжки. Буквенно-цифровые коды
// (INV-7 и т.п.) достаточно самобытны, чтобы совпадать и без якоря.
function purposeContainsNumber(purpose, number) {
  const esc = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const boundary = '[^\\p{L}\\d]';
  if (!new RegExp(`(^|${boundary})${esc}($|${boundary})`, 'u').test(purpose)) return false;
  if (!/^\d+$/.test(number)) return true;
  return new RegExp(`сч[её]т.{0,3}[^\\d]{0,10}${esc}($|${boundary})`, 'iu').test(purpose);
}

module.exports = {
  parseCsv, is1CFormat, parse1C, decodeStatement,
  parseAmountToKopecks, purposeContainsNumber, normalizeStatementRows,
};
