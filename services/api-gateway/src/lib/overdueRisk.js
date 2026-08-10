// Прогнозная эвристика риска просрочки контрагента — НЕ ML/чёрный ящик,
// а объяснимый расчёт на истории его последних N счетов. Сознательно
// отделена от counterparties.trust_score (статичное поле 0..100, которое
// уже участвует в прогнозе кассовых разрывов dashboard.js/cashflow-forecast
// и не должно менять смысл) — здесь отдельный, прозрачный индикатор,
// который можно объяснить пользователю одной фразой.
//
// Вход: список "закрытых для анализа" счетов контрагента, каждый —
//   { due_date: Date|string, paid_date: Date|string|null }
// paid_date = дата последнего платежа по счёту (для оплаченных счетов)
// либо null, если счёт всё ещё не оплачен (тогда просрочка считается
// на сегодняшний день — она уже фактическая, а не гипотетическая).
// Оба поля обязательны — счета без due_date в анализ не должны попадать
// (это решает вызывающий код при выборке из БД).

const DEFAULT_SAMPLE_SIZE = 10; // последние N счетов — стандартный размер выборки
const RISK_THRESHOLDS = { low: 0.2, medium: 0.5 }; // доля просроченных: <20% низкий, <50% средний, иначе высокий

function daysBetween(a, b) {
  const msA = new Date(a).setHours(0, 0, 0, 0);
  const msB = new Date(b).setHours(0, 0, 0, 0);
  return Math.round((msB - msA) / 86400000);
}

// Считает просрочку одного счёта в днях (0, если оплачен вовремя/досрочно).
function overdueDays(invoice, today) {
  const effectivePaid = invoice.paid_date || today;
  const delay = daysBetween(invoice.due_date, effectivePaid);
  return Math.max(0, delay);
}

/**
 * Считает индикатор риска просрочки по выборке из последних N счетов
 * контрагента (самые свежие due_date — последними в массиве или первыми,
 * функция сама сортирует по due_date по возрастанию).
 *
 * @param {Array<{due_date: string|Date, paid_date: string|Date|null}>} invoices
 * @param {{ sampleSize?: number, today?: Date }} [opts]
 * @returns {{
 *   level: 'low'|'medium'|'high', level_label: string,
 *   sample_size: number, overdue_count: number, overdue_share_pct: number,
 *   avg_delay_days: number, trend: 'improving'|'worsening'|'stable'|null,
 *   explanation: string,
 * }|null}  null — если истории недостаточно (нет счетов с due_date)
 */
function computeOverdueRisk(invoices, opts = {}) {
  const sampleSize = opts.sampleSize || DEFAULT_SAMPLE_SIZE;
  const today = opts.today || new Date();

  const clean = (invoices || []).filter(i => i && i.due_date);
  if (!clean.length) return null;

  // Берём последние sampleSize счетов по сроку оплаты (свежая история важнее старой).
  const sorted = [...clean].sort((a, b) => new Date(a.due_date) - new Date(b.due_date));
  const sample = sorted.slice(-sampleSize);

  const delays = sample.map(inv => overdueDays(inv, today));
  const overdueFlags = delays.map(d => d > 0);
  const overdueCount = overdueFlags.filter(Boolean).length;
  const overdueSharePct = Math.round((overdueCount / sample.length) * 100);

  const lateDelays = delays.filter(d => d > 0);
  const avgDelayDays = lateDelays.length
    ? Math.round(lateDelays.reduce((s, d) => s + d, 0) / lateDelays.length)
    : 0;

  const shareFraction = overdueCount / sample.length;
  let level, levelLabel;
  if (shareFraction < RISK_THRESHOLDS.low) { level = 'low'; levelLabel = 'Низкий риск просрочки'; }
  else if (shareFraction < RISK_THRESHOLDS.medium) { level = 'medium'; levelLabel = 'Средний риск просрочки'; }
  else { level = 'high'; levelLabel = 'Высокий риск просрочки'; }

  // Тренд: сравниваем среднюю просрочку по трём последним счетам с
  // предыдущими тремя (не хватает данных — тренд не определён).
  let trend = null;
  if (sample.length >= 6) {
    const lastThree = delays.slice(-3);
    const prevThree = delays.slice(-6, -3);
    const avg = arr => arr.reduce((s, d) => s + d, 0) / arr.length;
    const lastAvg = avg(lastThree);
    const prevAvg = avg(prevThree);
    const diff = lastAvg - prevAvg;
    if (diff <= -1) trend = 'improving';
    else if (diff >= 1) trend = 'worsening';
    else trend = 'stable';
  }

  const TREND_LABEL = { improving: 'улучшается', worsening: 'ухудшается', stable: 'без изменений' };
  let explanation;
  if (overdueCount === 0) {
    explanation = `Все ${sample.length} из последних ${sample.length} счетов оплачены в срок или раньше.`;
  } else {
    explanation = `${overdueCount} из последних ${sample.length} счетов просрочены` +
      (avgDelayDays > 0 ? `, в среднем на ${avgDelayDays} ${pluralDays(avgDelayDays)}` : '') + '.';
  }
  if (trend) explanation += ` Тренд по последним платежам: ${TREND_LABEL[trend]}.`;

  return {
    level,
    level_label: levelLabel,
    sample_size: sample.length,
    overdue_count: overdueCount,
    overdue_share_pct: overdueSharePct,
    avg_delay_days: avgDelayDays,
    trend,
    explanation,
  };
}

function pluralDays(n) {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'дня';
  return 'дней';
}

module.exports = { computeOverdueRisk, DEFAULT_SAMPLE_SIZE };
