// Расчёт итогов выставленного счёта — сумма всегда производная от позиций,
// клиентским суммам не доверяем (тот же принцип, что и у invoice_items).
// НДС считается "в том числе" (ставка уже заложена в цену позиции) —
// стандартная практика для счёта на оплату в РФ.
function calcAmountKopecks(quantity, unitPriceKopecks) {
  return Math.round(quantity * unitPriceKopecks);
}

function calcTotals(items, vatMode, vatRate) {
  const amount_kopecks = items.reduce((sum, it) => sum + calcAmountKopecks(it.quantity, it.unit_price_kopecks), 0);
  const vat_kopecks = vatMode === 'rate' && vatRate > 0
    ? Math.round(amount_kopecks - amount_kopecks / (1 + vatRate / 100))
    : 0;
  return { amount_kopecks, vat_kopecks };
}

module.exports = { calcAmountKopecks, calcTotals };
