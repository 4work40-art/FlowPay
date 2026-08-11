// Валидация входных данных при создании счёта — вынесена из routes/invoices.js
// в чистые функции без обращений к БД, чтобы регрессионные проверки (например,
// обязательность due_date) можно было покрыть юнит-тестами напрямую.

// Проверка полей одиночного счёта (POST /invoices). Возвращает текст ошибки
// или null, если всё в порядке. Проверка позиций (items) остаётся в
// routes/invoices.js (validateItems) — она используется отдельно ещё и при
// добавлении/обновлении позиций существующего счёта.
function validateInvoiceCreate(body) {
  const { amount_kopecks, due_date } = body || {};
  // Отдельно отличаем "это вообще не число" (например, фронт прислал NaN
  // из-за мусорного ввода вроде "-500abc") от "число есть, но не больше
  // нуля" — иначе сообщение "Сумма должна быть больше нуля" вводит
  // в заблуждение, когда проблема в том, что сумма не распознана как число.
  if (amount_kopecks === undefined || amount_kopecks === null || Number.isNaN(amount_kopecks))
    return 'Сумма указана некорректно';
  if (!Number.isInteger(amount_kopecks))
    return 'Сумма должна быть целым числом (в копейках)';
  if (amount_kopecks <= 0)
    return 'Сумма должна быть больше нуля';
  if (!due_date)
    return 'Укажите срок оплаты счёта — без него счёт не попадёт в календарь оплат и не будет учтён в просрочках';
  return null;
}

// Проверка одной строки пакетного создания (POST /invoices/bulk). Сообщения
// умышленно отличаются от validateInvoiceCreate — они относятся к строке
// реестра, а не к телу запроса на создание одного счёта.
function validateBulkInvoiceItem(item) {
  const { amount_kopecks, due_date } = item || {};
  // Та же логика, что и в validateInvoiceCreate: отдельно сообщаем, когда
  // сумма строки реестра вообще не распознана как целое число, и отдельно —
  // когда число есть, но не больше нуля.
  if (amount_kopecks === undefined || amount_kopecks === null || Number.isNaN(amount_kopecks) || !Number.isInteger(amount_kopecks))
    return 'Сумма указана некорректно (должна быть целым числом в копейках)';
  if (amount_kopecks <= 0)
    return 'Сумма должна быть больше нуля';
  if (!due_date)
    return 'Укажите срок оплаты — без него счёт не попадёт в календарь оплат и не будет учтён в просрочках';
  return null;
}

module.exports = { validateInvoiceCreate, validateBulkInvoiceItem };
