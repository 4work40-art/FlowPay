'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    api.payments.list()
      .then(r => setPayments(r.data?.items ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Платежи</div>
      </div>

      <div className="card">
        {loading ? (
          <div className="loading">⏳ Загрузка...</div>
        ) : (
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
                  <tr><td colSpan={5} className="empty-state">Платежей нет</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{payments.length} платежей</span>
        </div>
      </div>
    </div>
  );
}
