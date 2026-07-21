// Проверка ОГРН/ОГРНИП (контрольная сумма по алгоритму ФНС) и формата
// банковских реквизитов (БИК, номера счетов). Как и ИНН — используется для
// мягкой валидации: невалидное значение не блокирует сохранение, только
// помечается предупреждением.

// ОГРН (13 цифр, юрлицо): последняя цифра = остаток от деления первых 12
// цифр на 11, взятый по модулю 10. ОГРНИП (15 цифр, ИП) — аналогично по модулю 13.
function isValidOgrn(ogrn) {
  if (typeof ogrn !== 'string') return false;
  if (/^\d{13}$/.test(ogrn)) {
    const n = BigInt(ogrn.slice(0, 12));
    const check = Number(n % 11n % 10n);
    return check === Number(ogrn[12]);
  }
  if (/^\d{15}$/.test(ogrn)) {
    const n = BigInt(ogrn.slice(0, 14));
    const check = Number(n % 13n % 10n);
    return check === Number(ogrn[14]);
  }
  return false;
}

// БИК банка РФ: 9 цифр, первые две — код страны (04), 3-4 — код региона.
function isValidBik(bik) {
  return typeof bik === 'string' && /^04\d{7}$/.test(bik);
}

// Расчётный/корреспондентский счёт — 20 цифр. Контроль по БИК (последние
// 3 цифры БИК + счёт должны проходить контрольную сумму ЦБ) не проверяем —
// это требует знания типа счёта и валюты, избыточно для мягкой валидации.
function isValidAccountNumber(account) {
  return typeof account === 'string' && /^\d{20}$/.test(account);
}

module.exports = { isValidOgrn, isValidBik, isValidAccountNumber };
