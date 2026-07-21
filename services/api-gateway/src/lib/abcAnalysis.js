// ABC-анализ по объёму закупок (правило Парето): группа A — контрагенты,
// дающие первые 80% суммарного объёма; B — следующие 15% (до 95%);
// C — оставшиеся 5%. Стандартная методика закупочной аналитики.
// Чистая функция без БД — покрыта юнит-тестами.

function classifyAbc(items) {
  const sorted = [...items].sort((a, b) => b.total_kopecks - a.total_kopecks);
  const grandTotal = sorted.reduce((sum, it) => sum + it.total_kopecks, 0);
  if (grandTotal <= 0) return sorted.map(it => ({ ...it, share_pct: 0, cumulative_pct: 0, group: 'C' }));

  let cumulative = 0;
  return sorted.map(it => {
    // Группа определяется по накопленному проценту ДО добавления текущего
    // элемента — иначе единственный поставщик со 100% объёма попал бы в C
    // (что абсурдно: он и есть единственный поставщик, самый критичный).
    // Элемент, который «пробивает» порог 80%/95%, всё ещё относится к
    // предыдущей группе — стандартная практика ABC-анализа.
    const cumulativeBefore_pct = (cumulative / grandTotal) * 100;
    const group = cumulativeBefore_pct < 80 ? 'A' : cumulativeBefore_pct < 95 ? 'B' : 'C';

    cumulative += it.total_kopecks;
    const cumulative_pct = (cumulative / grandTotal) * 100;
    const share_pct = (it.total_kopecks / grandTotal) * 100;
    return { ...it, share_pct: Math.round(share_pct * 10) / 10, cumulative_pct: Math.round(cumulative_pct * 10) / 10, group };
  });
}

module.exports = { classifyAbc };
