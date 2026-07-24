'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ArrowUpRight, ShieldCheck, CircleAlert, CalendarClock, ArrowRight, Square } from 'lucide-react';
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

const NEEDS_ACTION = new Set(['CREATED', 'UNDER_CONTROL', 'OVERDUE', 'PARTIALLY_PAID', 'DISPUTED']);

function statusTagClass(status: string) {
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
    return <div className="loading">Загрузка данных…</div>;
  }

  if (error) {
    return (
      <div className="error-box">
        <strong>Не удалось загрузить данные:</strong> {error}
        <br />
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}>
          <RefreshCw size={14} strokeWidth={1.5} /> Повторить
        </button>
      </div>
    );
  }

  const user = getStoredUser();
  const actionable = invoices.filter(i => NEEDS_ACTION.has(i.status));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Дашборд</div>
          <div className="page-sub">{user?.org_name ?? '—'} · {ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}</div>
        </div>
        <button className="btn btn-secondary btn-icon" onClick={load} title="Обновить">
          <RefreshCw size={16} strokeWidth={1.5} />
        </button>
      </div>

      {summary?.total_invoices === 0 && (
        <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-title">Первые шаги в Счёт&amp;Контроль</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
            <a href="/invoices/new" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Square size={15} strokeWidth={1.5} /> Загрузить первый счёт
            </a>
            <a href="/counterparties" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Square size={15} strokeWidth={1.5} /> Добавить контрагента
            </a>
            <a href="/settings" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Square size={15} strokeWidth={1.5} /> Пригласить коллегу (бухгалтера или ассистента)
            </a>
          </div>
        </div>
      )}

      <div className="grid-2" style={{ marginBottom: 'var(--space-4)', alignItems: 'stretch' }}>
        {/* Hero: total debt + CTA */}
        <div className="debt-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="debt-label">Всего задолженности</div>
          <div className="debt-value">{summary?.total_debt?.display ?? '—'}</div>
          <div className="debt-sub">{summary?.total_invoices ?? 0} счетов в системе</div>
          <a href="/invoices/new" className="btn btn-primary btn-block blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <ArrowUpRight size={15} strokeWidth={1.5} /> Загрузить новый счёт
          </a>
        </div>

        {/* Side column: alerts + trust score */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="alert-card blueprint" role="alert">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="alert-title"><CircleAlert size={13} strokeWidth={1.5} /> Просроченные</div>
            <div className="alert-value">{summary?.overdue_debt?.display ?? '—'}</div>
            <div className="alert-sub">{summary?.overdue_debt?.count ?? 0} счетов · требуют внимания</div>
          </div>
          <div className="alert-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="alert-title"><CalendarClock size={13} strokeWidth={1.5} /> На оплату (7 дней)</div>
            <div className="alert-value">{summary?.due_7_days?.display ?? '—'}</div>
            <div className="alert-sub">{summary?.due_7_days?.count ?? 0} счетов · срок истекает</div>
          </div>
          <div className="trust-card blueprint" style={{ marginBottom: 0, flex: 1 }} aria-label={`Trust Score ${summary?.trust_score ?? 50} из 100`}>
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="trust-info">
              <div className="trust-label"><ShieldCheck size={13} strokeWidth={1.5} style={{ verticalAlign: -2 }} /> Статус доверия</div>
              <div className="trust-bar-wrap">
                <div className="trust-bar-fill" style={{ width: `${summary?.trust_score ?? 50}%` }} />
              </div>
              <div className="trust-sub">Надёжный партнёр · Топ 25% платформы</div>
            </div>
            <div>
              <div className="trust-score">{summary?.trust_score ?? 50}</div>
              <div className="trust-score-sub">из 100</div>
            </div>
          </div>
        </div>
      </div>

      {/* Требуют действия */}
      <div className="card blueprint">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span>Требуют действия</span>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>№</th>
                <th>Контрагент</th>
                <th style={{ width: 140 }}>Сумма</th>
                <th style={{ width: 140 }}>Статус</th>
                <th style={{ width: 220 }}></th>
              </tr>
            </thead>
            <tbody>
              {actionable.map(inv => (
                <tr key={inv.id}>
                  <td className="mono text-muted">#{inv.number}</td>
                  <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                  <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                  <td>
                    <span className={statusTagClass(inv.status)}>{STATUS_LABEL[inv.status] ?? inv.status}</span>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {inv.status === 'CREATED' && (
                        <button className="btn btn-primary btn-sm" disabled={acting === inv.id}
                          onClick={() => doTransition(inv.id, 'mark_for_control')}>На контроль</button>
                      )}
                      {inv.status === 'UNDER_CONTROL' && (
                        <button className="btn btn-primary btn-sm" disabled={acting === inv.id}
                          onClick={() => doTransition(inv.id, 'set_pending')}>Ожидает оплаты</button>
                      )}
                      {inv.status === 'OVERDUE' && (
                        <button className="btn btn-secondary btn-sm" disabled={acting === inv.id}
                          onClick={() => doTransition(inv.id, 'write_off')}>Списать</button>
                      )}
                      <a href={`/invoices/${inv.id}`} className="btn btn-ghost btn-sm">
                        Подробнее <ArrowRight size={13} strokeWidth={1.5} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {!actionable.length && (
                <tr>
                  <td colSpan={5} className="empty-state">
                    {invoices.length ? 'Нет счетов, требующих действия' : (
                      <>Счетов пока нет. <a href="/invoices/new">Загрузить первый счёт →</a></>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="table-footer">
          <span>{actionable.length} требуют действия из {invoices.length}</span>
          <a href="/invoices">Все счета →</a>
        </div>
      </div>
    </div>
  );
}
