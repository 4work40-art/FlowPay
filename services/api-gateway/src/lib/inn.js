// Проверка ИНН по контрольным суммам (алгоритм ФНС) и КПП по формату.
// ИНН юрлица — 10 цифр (1 контрольная), ИНН ИП/физлица — 12 цифр (2 контрольные).

function checksum(digits, weights) {
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (sum % 11) % 10;
}

function isValidInn(inn) {
  if (typeof inn !== 'string' || !/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  if (inn.length === 10) {
    return checksum(d, [2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  }
  return (
    checksum(d, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] &&
    checksum(d, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11]
  );
}

// КПП: 4 цифры + 2 буквы/цифры + 3 цифры (формат ФНС).
function isValidKpp(kpp) {
  return typeof kpp === 'string' && /^\d{4}[\dA-ZА-Я]{2}\d{3}$/.test(kpp);
}

// Валидация опциональных реквизитов из тела запроса: пусто — допустимо,
// заполнено — должно быть корректным. Возвращает текст ошибки или null.
function validateRequisites({ inn, kpp }) {
  if (inn !== undefined && inn !== null && inn !== '' && !isValidInn(String(inn).trim()))
    return 'ИНН некорректен: проверьте количество цифр и правильность ввода';
  if (kpp !== undefined && kpp !== null && kpp !== '' && !isValidKpp(String(kpp).trim()))
    return 'КПП некорректен: ожидается 9 знаков в формате ФНС';
  return null;
}

module.exports = { isValidInn, isValidKpp, validateRequisites };
