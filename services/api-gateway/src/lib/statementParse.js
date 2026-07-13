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

function parseAmountToKopecks(raw) {
  const normalized = raw.replace(/\s/g, '').replace(',', '.');
  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

// Номер счёта должен встречаться в назначении платежа как отдельный токен,
// а не как подстрока: счёт «1» не должен «находиться» в «оплата по счёту 104».
// Границей считаем любой не-буквенно-цифровой символ или край строки.
function purposeContainsNumber(purpose, number) {
  const esc = number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\d])${esc}($|[^\\p{L}\\d])`, 'u').test(purpose);
}

module.exports = {
  parseCsv, is1CFormat, parse1C, decodeStatement,
  parseAmountToKopecks, purposeContainsNumber,
};
