'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, STATUS_LABEL, STATUS_ICON } from '@/lib/api';

type Invoice = {
  id: string; number: string | null; counterparty_name: string | null;
  amount_display: string; status: string; due_date: string;
};

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function pad(n: number) { return String(n).padStart(2, '0'); }
function ymd(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }

function buildGrid(year: number, month: number): (Date | null)[][] {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const STATUS_COLOR: Record<string, string> = {
  OVERDUE: 'var(--red, #c0392b)',
  DISPUTED: 'var(--red, #c0392b)',
  PAYMENT_PENDING: 'var(--amber-dark, #a06a00)',
  UNDER_CONTROL: 'var(--blue-dark, #1a5fb4)',
  PARTIALLY_PAID: 'var(--amber-dark, #a06a00)',
  PAID: 'var(--green-dark, #1a7a4c)',
};

export default function CalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const from = ymd(new Date(year, month, 1));
    const to = ymd(new Date(year, month + 1, 0));
    api.invoices.list({ due_from: from, due_to: to, limit: '100' })
      .then(res => setInvoices(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setMonth(m); setYear(y);
  };

  const byDay = new Map<string, Invoice[]>();
  for (const inv of invoices) {
    if (!inv.due_date) continue;
    const key = inv.due_date.slice(0, 10);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(inv);
  }

  const weeks = buildGrid(year, month);
  const todayKey = ymd(now);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Календарь оплат</div>
          <div className="page-sub">Счета по сроку оплаты — ничего не пропустите</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-sm" onClick={() => changeMonth(-1)}>← Пред.</button>
          <div style={{ fontWeight: 600, minWidth: 160, textAlign: 'center' }}>{MONTH_NAMES[month]} {year}</div>
          <button className="btn btn-sm" onClick={() => changeMonth(1)}>След. →</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">⏳ Загрузка...</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
            {WEEKDAYS.map(w => (
              <div key={w} style={{ padding: '8px 6px', fontSize: 12.5, fontWeight: 600, color: 'var(--text2)', textAlign: 'center' }}>{w}</div>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
              {week.map((day, di) => {
                const key = day ? ymd(day) : '';
                const dayInvoices = day ? (byDay.get(key) ?? []) : [];
                const isToday = key === todayKey;
                return (
                  <div key={di} style={{
                    minHeight: 96, padding: 6, borderRight: di < 6 ? '1px solid var(--border)' : undefined,
                    background: isToday ? 'var(--gold-light, #F1E2C2)' : undefined, opacity: day ? 1 : 0.4,
                  }}>
                    {day && (
                      <>
                        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 4 }}>{day.getDate()}</div>
                        {dayInvoices.slice(0, 4).map(inv => (
                          <a key={inv.id} href={`/invoices/${inv.id}`} title={`№${inv.number ?? '—'} · ${inv.counterparty_name ?? 'без контрагента'} · ${inv.amount_display}`}
                            style={{
                              display: 'block', fontSize: 11, marginBottom: 3, padding: '2px 4px', borderRadius: 4,
                              background: 'var(--card-bg2, #f7f5ef)', color: STATUS_COLOR[inv.status] ?? 'inherit',
                              textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}>
                            {STATUS_ICON[inv.status] ?? ''} №{inv.number ?? '—'} · {inv.amount_display}
                          </a>
                        ))}
                        {dayInvoices.length > 4 && (
                          <div style={{ fontSize: 11, color: 'var(--text2)' }}>+{dayInvoices.length - 4} ещё</div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
