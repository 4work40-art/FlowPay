'use client';
import { useEffect, useState } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import { api, OUTGOING_STATUS_LABEL, OUTGOING_STATUS_DESCRIPTION, formatDateOnly } from '@/lib/api';

function statusTagClass(status: string) {
  if (status === 'overdue') return 'tag tag-accent';
  if (status === 'paid') return 'tag tag-outline';
  if (status === 'cancelled') return 'tag tag-neutral';
  return 'tag tag-neutral';
}

const FILTERS: [string, string][] = [
  ['', 'Все'],
  ['draft', 'Черновики'],
  ['sent', 'Отправлены'],
  ['overdue', 'Просрочены'],
  ['paid', 'Оплачены'],
  ['cancelled', 'Отменены'],
];

type OutgoingInvoice = {
  id: string; number: string; counterparty_name: string | null;
  amount_display: string; status: string; issue_date: string; due_date: string | null;
};

export default function OutgoingInvoicesPage() {
  const [invoices, setInvoices] = useState<OutgoingInvoice[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    setLoading(true); setError('');
    api.outgoingInvoices.list(status ? { status } : {})
      .then(r => setInvoices(r.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  // Контроль по выставленным счетам: сколько отправлено и ждёт оплаты,
  // сколько просрочено — видно сразу, без захода в каждый счёт.
  const pendingCount = invoices.filter(i => i.status === 'sent').length;
  const overdueCount = invoices.filter(i => i.status === 'overdue').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Выставленные счета</div>
          <div className="page-sub">Счета, которые вы выставляете клиентам — отдельно от счетов на оплату от поставщиков</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-icon" onClick={load} title="Обновить"><RefreshCw size={16} strokeWidth={1.5} /></button>
          <a href="/outgoing-invoices/new" className="btn btn-primary blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={14} strokeWidth={1.5} /> Выставить счёт
          </a>
        </div>
      </div>

      {!loading && !error && (pendingCount > 0 || overdueCount > 0) && (
        <div className="metric-grid" style={{ marginBottom: 'var(--space-4)' }}>
          <div className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">Ждут оплаты</div>
            <div className="metric-value">{pendingCount}</div>
          </div>
          <div className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">Просрочены</div>
            <div className="metric-value">{overdueCount}</div>
          </div>
        </div>
      )}

      <div className="seg" style={{ marginBottom: 'var(--space-4)' }}>
        {FILTERS.map(([v, l]) => (
          <label key={v} className="seg-opt">
            <input type="radio" name="outgoing-status" checked={status === v} onChange={() => setStatus(v)} />
            {l}
          </label>
        ))}
      </div>

      {error && (
        <div className="error-box">
          {error} <button className="btn btn-sm" onClick={load} style={{ marginLeft: 8 }}>Повторить</button>
        </div>
      )}

      <div className="card blueprint">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        {loading ? (
          <div className="loading">Загрузка…</div>
        ) : (
          <div className="table-wrap responsive-table">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }} scope="col">№</th>
                  <th scope="col">Клиент</th>
                  <th style={{ width: 150 }} scope="col">Сумма</th>
                  <th style={{ width: 120 }} scope="col">Дата</th>
                  <th style={{ width: 150 }} scope="col">Статус</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="clickable" tabIndex={0} role="link"
                    aria-label={`Счёт №${inv.number}, ${inv.counterparty_name || '—'}, ${inv.amount_display}`}
                    onClick={() => window.location.href = `/outgoing-invoices/${inv.id}`}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.location.href = `/outgoing-invoices/${inv.id}`; } }}>
                    <td className="mono text-muted" data-label="№">#{inv.number}</td>
                    <td data-label="Клиент" style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                    <td data-label="Сумма" style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                    <td data-label="Дата" className="text-muted" style={{ fontSize: 12 }}>{formatDateOnly(inv.issue_date)}</td>
                    <td data-label="Статус">
                      <span className={statusTagClass(inv.status)} title={OUTGOING_STATUS_DESCRIPTION[inv.status] ?? ''}>
                        {OUTGOING_STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr><td colSpan={5} className="empty-state">
                    Выставленных счетов пока нет. <a href="/outgoing-invoices/new">Выставить первый счёт →</a>
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
