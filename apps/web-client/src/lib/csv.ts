// Постранично тянет весь список (не только текущую страницу UI) для
// полного экспорта — сервер отдаёт максимум 100 записей за запрос.
export async function fetchAllPages<T>(
  list: (params: Record<string, string>) => Promise<{ data: { items: T[]; total: number } }>,
  baseParams: Record<string, string> = {}
): Promise<T[]> {
  const limit = 100;
  let page = 1;
  const all: T[] = [];
  for (;;) {
    const res = await list({ ...baseParams, page: String(page), limit: String(limit) });
    const items = res.data?.items ?? [];
    all.push(...items);
    if (all.length >= (res.data?.total ?? 0) || !items.length) break;
    page += 1;
  }
  return all;
}

export function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(';'), ...rows.map(r => r.map(esc).join(';'))];
  // BOM — чтобы Excel корректно открывал кириллицу в UTF-8
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
