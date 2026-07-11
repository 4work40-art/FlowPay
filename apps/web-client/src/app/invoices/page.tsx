'use client';
import { useEffect, useState } from 'react';
import { api, STATUS_LABEL, STATUS_ICON } from '@/lib/api';

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [status,   setStatus]   = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = () => {
    setLoading(true); setError('');
    api.invoices.list(status ? { status } : {})
      .then(r => setInvoices(r.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Счета</div>
        <a href="/invoices/new" className="btn btn-primary">+ Загрузить счёт</a>
      </div>

      <div className="filter-row">
        {[
          ['', 'Все'],
          ['OVERDUE',        '⏰ Просрочены'],
          ['PARTIALLY_PAID', '% Частично'],
          ['UNDER_CONTROL',  '👁 На контроле'],
          ['PAID',           '✓ Оплачены'],
          ['CREATED',        '📄 Созданы'],
        ].map(([v, l]) => (
          <button key={v}
            className={`filter-pill${status === v ? ' active' : ''}`}
            onClick={() => setStatus(v)}>
            {l}
          </button>
        ))}
      </div>

      {error && (
        <div className="error-box">
          {error} <button className="btn btn-sm" onClick={load} style={{ marginLeft: 8 }}>Повторить</button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">⏳ Загрузка...</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 70 }}>№</th>
                  <th>Контрагент</th>
                  <th style={{ width: 150 }}>Сумма</th>
                  <th style={{ width: 130 }}>Срок оплаты</th>
                  <th style={{ width: 150 }}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id} className="clickable"
                    onClick={() => window.location.href = `/invoices/${inv.id}`}>
                    <td className="mono" style={{ color: '#888' }}>#{inv.number}</td>
                    <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                    <td style={{ color: '#888', fontSize: 12 }}>{inv.due_date ?? '—'}</td>
                    <td>
                      <span className={`status-badge status-${inv.status}`}>
                        {STATUS_ICON[inv.status]} {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!invoices.length && (
                  <tr><td colSpan={5} className="empty-state">Счетов нет</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{invoices.length} счетов</span>
          <a href="/dashboard">← Dashboard</a>
        </div>
      </div>
    </div>
  );
}
