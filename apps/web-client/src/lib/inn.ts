// Клиентская валидация ИНН РФ — тот же алгоритм ФНС, что и на бэкенде
// (services/api-gateway/src/lib/inn.js). Дублируется намеренно: фронт и
// бэк — разные пакеты без общего рантайма, а сама проверка детерминирована
// и не должна расходиться. При изменении алгоритма правьте оба файла.

function checksum(digits: number[], weights: number[]): number {
  const sum = weights.reduce((acc, w, i) => acc + w * digits[i], 0);
  return (sum % 11) % 10;
}

export function isValidInn(inn: string): boolean {
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

// Понятное сообщение об ошибке для формы; null, если ИНН корректен.
export function innError(inn: string): string | null {
  const trimmed = (inn || '').trim();
  if (!trimmed) return 'Укажите ИНН — обязателен при создании контрагента';
  if (!/^\d{10}$|^\d{12}$/.test(trimmed))
    return 'ИНН должен состоять из 10 цифр (юрлицо) или 12 цифр (ИП/физлицо)';
  if (!isValidInn(trimmed))
    return 'ИНН указан некорректно — не совпадает контрольная сумма, проверьте цифры';
  return null;
}

// Нормализация названия для мягкого сравнения на похожесть (см. дубли
// на бэкенде: services/api-gateway/src/routes/counterparties.js).
export function normalizeName(name: string): string {
  return (name || '').trim().toLowerCase().replace(/\s+/g, '');
}
