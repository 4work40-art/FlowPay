'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  Wallet, ArrowUp, Clock, CalendarDays, ShieldCheck, RefreshCw,
  ChevronRight, Plus, FileCheck, UserPlus, UserCog,
} from 'lucide-react';
import { api, STATUS_LABEL, ROLE_LABEL, PLAN_LABEL, formatDateOnly } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';

type Invoice = {
  id: string;
  number: string;
  counterparty_name: string;
  amount_kopecks: number;
  paid_kopecks: number;
  remaining_kopecks: number;
  amount_display: string;
  paid_display: string;
  remaining_display: string;
  status: string;
  due_date: string;
};

function Corners() {
  return (
    <>
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
    </>
  );
}

function tagClass(status: string) {
  if (status === 'OVERDUE' || status === 'DISPUTED') return 'tag tag-accent';
  if (status === 'PAID' || status === 'PARTIALLY_PAID' || status === 'PAYMENT_PENDING') return 'tag tag-outline';
  return 'tag tag-neutral';
}

export default function DashboardPage() {
  const [summary,  setSummary]  = useState<any>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [acting,   setActing]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.dashboard.summary(),
      api.invoices.list({ limit: '10' }),
    ])
      .then(([s, inv]) => {
        setSummary(s.data);
        setInvoices(inv.data?.items ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doTransition = async (invoiceId: string, transition: string) => {
    setActing(invoiceId);
    try {
      await api.invoices.transition(invoiceId, transition);
      load();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    } finally {
      setActing(null);
    }
  };

  if (loading) {
    return <div className="loading">Загрузка данных...</div>;
  }

  if (error) {
    return (
      <div>
        <div className="error-box">
          <strong>Не удалось загрузить данные:</strong> {error}
          <br />
          <span style={{ fontSize: 12, opacity: .8 }}>
            Проверьте подключение к интернету и попробуйте ещё раз.
          </span>
          <br />
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}>
            <RefreshCw size={14} strokeWidth={1.5} /> Повторить
          </button>
        </div>
      </div>
    );
  }

  const user = getStoredUser();

  // "Требуют действия" — action-needed invoices, not the full list
  const actionable = invoices.filter(i => i.status !== 'PAID' && i.status !== 'ARCHIVED' && i.status !== 'WRITTEN_OFF');

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Дашборд</h1>
          <div className="page-sub">
            {user?.org_name ?? '—'} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}
          </div>
        </div>
        <button type="button" className="btn btn-ghost btn-icon" title="Обновить" aria-label="Обновить" onClick={load}>
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: '1.3fr 1fr', marginBottom: 20 }}>
        <div className="card blueprint" style={{ padding: 28, position: 'relative' }}>
          <Corners />
          <div style={{ fontSize: 12, color: 'var(--color-neutral-700)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Wallet size={15} strokeWidth={1.5} /> Всего задолженности
          </div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 56, fontWeight: 600, color: 'var(--color-accent-700)', lineHeight: 1 }}>
            {summary?.total_debt?.display ?? '—'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-neutral-700)', marginTop: 8 }}>
            {summary?.total_invoices ?? 0} счетов в системе
          </div>
          <div style={{ marginTop: 20 }}>
            <a href="/invoices/new" className="btn btn-primary blueprint">
              <Corners />
              <ArrowUp size={15} strokeWidth={1.5} /> Загрузить новый счёт
            </a>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card blueprint" style={{ padding: '16px 18px', position: 'relative' }}>
            <Corners />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div className="alert-title"><Clock size={13} strokeWidth={1.5} /> Просроченные</div>
                <div className="alert-value">{summary?.overdue_debt?.display ?? '—'}</div>
              </div>
              <span className="tag tag-accent" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{summary?.overdue_debt?.count ?? 0} счетов</span>
            </div>
          </div>
          <div className="card blueprint" style={{ padding: '16px 18px', position: 'relative' }}>
            <Corners />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div className="alert-title"><CalendarDays size={13} strokeWidth={1.5} /> На оплату (7 дней)</div>
                <div className="alert-value">{summary?.due_7_days?.display ?? '—'}</div>
              </div>
              <span className="tag tag-outline" style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>{summary?.due_7_days?.count ?? 0} счёта</span>
            </div>
          </div>
          <div className="card blueprint trust-card" style={{ marginBottom: 0 }}>
            <Corners />
            <div>
              <div className="trust-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={13} strokeWidth={1.5} /> Trust Score
              </div>
              <div className="trust-bar-wrap"><div className="trust-bar-fill" style={{ width: `${summary?.trust_score ?? 50}%` }} /></div>
            </div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28, fontWeight: 600, color: 'var(--color-accent-700)' }}>
              {summary?.trust_score ?? 50}
            </div>
          </div>
        </div>
      </div>

      <div className="section-title">Требуют действия</div>
      <div className="card blueprint" style={{ position: 'relative', padding: 0 }}>
        <Corners />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>№</th>
                <th>Контрагент</th>
                <th style={{ width: 130 }}>Сумма</th>
                <th style={{ width: 160 }}>Статус</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {actionable.map(inv => (
                <tr key={inv.id}>
                  <td className="mono">#{inv.number}</td>
                  <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                  <td><span className={tagClass(inv.status)}>{STATUS_LABEL[inv.status] ?? inv.status}</span></td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <a href={`/invoices/${inv.id}`} className="btn btn-ghost btn-icon" title="Подробнее">
                      <ChevronRight size={15} strokeWidth={1.5} />
                    </a>
                    {inv.status !== 'CREATED' && (
                      <a href={`/payments/new?invoice=${inv.id}`} className="btn btn-secondary blueprint" style={{ padding: '5px 10px', fontSize: 12 }}>
                        <Corners /><Plus size={13} strokeWidth={1.5} /> Платёж
                      </a>
                    )}
                    {inv.status === 'CREATED' && (
                      <button
                        className="btn btn-secondary blueprint"
                        style={{ padding: '5px 10px', fontSize: 12 }}
                        disabled={acting === inv.id}
                        onClick={() => doTransition(inv.id, 'mark_for_control')}>
                        <Corners /> На контроль
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!actionable.length && (
                <tr><td colSpan={5} className="empty-state">Нет счетов, требующих действия.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{actionable.length} из {invoices.length} счетов</span>
          <a href="/invoices">Все счета <ChevronRight size={12} strokeWidth={1.5} style={{ display: 'inline' }} /></a>
        </div>
      </div>

      {summary?.total_invoices === 0 && (
        <>
          <div className="section-title">Первые шаги</div>
          <div className="card blueprint" style={{ position: 'relative', padding: '16px 20px', maxWidth: 420 }}>
            <Corners />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <a href="/invoices/new" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)' }}>
                <FileCheck size={15} strokeWidth={1.5} /> Загрузить первый счёт
              </a>
              <a href="/counterparties" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)' }}>
                <UserPlus size={15} strokeWidth={1.5} /> Добавить контрагента
              </a>
              <a href="/settings" style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text)' }}>
                <UserCog size={15} strokeWidth={1.5} /> Пригласить коллегу
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
