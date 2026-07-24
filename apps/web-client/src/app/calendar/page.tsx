'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, STATUS_LABEL } from '@/lib/api';

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

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

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
          <h1 className="page-title">Календарь оплат</h1>
          <div className="page-sub">Счета по сроку оплаты — ничего не пропустите</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => changeMonth(-1)}>← Пред.</button>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15, textTransform: 'uppercase', minWidth: 170, textAlign: 'center' }}>{MONTH_NAMES[month]} {year}</div>
          <button className="btn btn-ghost btn-sm" onClick={() => changeMonth(1)}>След. →</button>
        </div>
      </div>

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card blueprint" style={{ position: 'relative', padding: 0 }}>
          <Corners />
          <div className="cal-weekdays">
            {WEEKDAYS.map(w => <div key={w}>{w}</div>)}
          </div>
          {weeks.map((week, wi) => (
            <div className="cal-week" key={wi}>
              {week.map((day, di) => {
                const key = day ? ymd(day) : '';
                const dayInvoices = day ? (byDay.get(key) ?? []) : [];
                const isToday = key === todayKey;
                return (
                  <div key={di} className={`cal-day${isToday ? ' today' : ''}${!day ? ' dim' : ''}`}>
                    {day && (
                      <>
                        <div className="cal-daynum">{day.getDate()}</div>
                        {dayInvoices.slice(0, 4).map(inv => (
                          <a key={inv.id} href={`/invoices/${inv.id}`}
                            className={`cal-chip${inv.status === 'OVERDUE' || inv.status === 'DISPUTED' ? ' overdue' : ''}`}
                            title={`№${inv.number ?? '—'} · ${inv.counterparty_name ?? 'без контрагента'} · ${inv.amount_display} · ${STATUS_LABEL[inv.status] ?? inv.status}`}>
                            №{inv.number ?? '—'} · {inv.amount_display}
                          </a>
                        ))}
                        {dayInvoices.length > 4 && (
                          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>+{dayInvoices.length - 4} ещё</div>
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
