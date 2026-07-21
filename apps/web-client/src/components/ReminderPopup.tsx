'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Reminder = {
  id: string; number: string | null; counterparty_name: string | null;
  due_date: string; status: string; remaining_display: string;
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}
const DISMISS_KEY = 'sk_reminders_dismissed_on';

// Напоминания об оплате внутри личного кабинета — всплывающее сообщение
// вместо email/мессенджеров (те пока не подключены; серверный эндпоинт и
// поле «за сколько дней напоминать» уже готовы для них на будущее). Не
// показывается повторно в течение того же дня после того, как пользователь
// закрыл окно.
export default function ReminderPopup() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(DISMISS_KEY) === todayKey()) return;
    api.dashboard.reminders()
      .then(res => {
        const list = res.data?.items ?? [];
        if (list.length) { setItems(list); setVisible(true); }
      })
      .catch(() => {});
  }, []);

  if (!visible || !items.length) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, todayKey());
    setVisible(false);
  };

  return (
    <div className="card" style={{
      marginBottom: 16, borderColor: 'var(--amber-dark, #a06a00)',
      background: 'var(--amber-light, #fdf1de)',
    }}>
      <div className="card-header" style={{ color: 'var(--amber-dark, #a06a00)' }}>
        <span>🔔 Напоминание об оплате — {items.length} {items.length === 1 ? 'счёт' : 'счетов'}</span>
        <button className="btn btn-sm" onClick={dismiss}>Закрыть</button>
      </div>
      <div className="card-body" style={{ paddingTop: 0 }}>
        {items.slice(0, 5).map(it => (
          <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
            <a href={`/invoices/${it.id}`}>
              №{it.number ?? '—'} · {it.counterparty_name ?? 'без контрагента'}
            </a>
            <span style={{ fontWeight: 600 }}>
              {it.remaining_display} · срок {new Date(it.due_date).toLocaleDateString('ru-RU')}
            </span>
          </div>
        ))}
        {items.length > 5 && (
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <a href="/calendar">И ещё {items.length - 5} — открыть календарь оплат →</a>
          </div>
        )}
      </div>
    </div>
  );
}
