'use client';
import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';

const PAGE_SIZE = 20;

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.payments.list({ page: String(page), limit: String(PAGE_SIZE) })
      .then(r => { setPayments(r.data?.items ?? []); setTotal(r.data?.total ?? 0); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Платежи</div>
        <button
          className="btn btn-sm"
          disabled={!payments.length}
          onClick={() => downloadCsv(
            `payments_${new Date().toISOString().slice(0, 10)}.csv`,
            ['Дата', 'Счёт', 'Контрагент', 'Сумма, ₽', 'Способ', 'Референс'],
            payments.map(p => [p.payment_date, p.invoice_number ?? '', p.counterparty_name ?? '', (p.amount_kopecks / 100).toFixed(2), p.method ?? '', p.reference ?? ''])
          )}>
          ⭳ Экспорт CSV
        </button>
      </div>

      {error && (
        <div className="error-box">
          {error} <button className="btn btn-sm" onClick={load} style={{ marginLeft: 8 }}>Повторить</button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">⏳ Загрузка...</div>
        ) : !error && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Дата</th>
                  <th style={{ width: 80 }}>Счёт</th>
                  <th>Контрагент</th>
                  <th style={{ width: 150 }}>Сумма</th>
                  <th style={{ width: 100 }}>ПП</th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td style={{ color: '#888', fontSize: 12 }}>{p.payment_date}</td>
                    <td className="mono" style={{ color: '#888' }}>#{p.invoice_number}</td>
                    <td style={{ fontWeight: 500 }}>{p.counterparty_name || '—'}</td>
                    <td style={{ fontWeight: 600, color: '#085041' }}>{p.amount_display}</td>
                    <td style={{ color: '#888', fontSize: 12 }}>{p.reference || '—'}</td>
                  </tr>
                ))}
                {!payments.length && (
                  <tr><td colSpan={5} className="empty-state">
                    Платежей пока нет. Записать платёж можно со страницы конкретного счёта.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{total} платежей</span>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Назад</button>
              <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text2)' }}>{page} / {pages}</span>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Вперёд →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
