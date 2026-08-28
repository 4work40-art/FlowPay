// Клиентская валидация банковских реквизитов РФ — быстрая проверка формата до
// отправки формы (сервер проверяет повторно). Та же логика, что уже была
// локально в /settings; вынесена сюда, чтобы карточка контрагента и настройки
// организации проверяли реквизиты одинаково.

// КПП: 9 знаков, позиции 5–6 могут быть буквами (формат ФНС) — цифровой
// фильтр к нему НЕ применяется, только проверка формата.
export function kppError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}[\dA-ZА-Я]{2}\d{3}$/.test(v))
    return 'КПП некорректен: ожидается 9 знаков в формате ФНС';
  return null;
}

export function bikError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^04\d{7}$/.test(v))
    return 'БИК некорректен: ожидается 9 цифр, начинается с 04';
  return null;
}

export function accountError(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{20}$/.test(v))
    return `${label} некорректен: ожидается 20 цифр`;
  return null;
}
