'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, STATUS_LABEL, STATUS_ICON } from '@/lib/api';

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Банковский перевод', cash: 'Наличные', check: 'Чек', online: 'Онлайн-оплата',
};

export default function PublicInvoicePage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.public.invoice(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ width: 420, padding: 28 }}>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 4 }}>📄 Счёт&amp;Контроль</div>

        {loading && <div className="loading">⏳ Загрузка...</div>}
        {error && <div className="error-box">{error}</div>}

        {inv && (
          <>
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Счёт №{inv.number ?? '—'}</div>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>{inv.org_name}</div>

            <span className={`status-badge status-${inv.status}`} style={{ marginBottom: 16, display: 'inline-block' }}>
              {STATUS_ICON[inv.status]} {STATUS_LABEL[inv.status] ?? inv.status}
            </span>

            <div className="metric-grid" style={{ marginBottom: 16 }}>
              <div className="metric-card">
                <div className="metric-label">Сумма</div>
                <div className="metric-value" style={{ fontSize: 18 }}>{inv.amount_display}</div>
              </div>
              <div className="metric-card green">
                <div className="metric-label">Оплачено</div>
                <div className="metric-value" style={{ fontSize: 18 }}>{inv.paid_display}</div>
              </div>
              <div className="metric-card amber">
                <div className="metric-label">Остаток</div>
                <div className="metric-value" style={{ fontSize: 18 }}>{inv.remaining_display}</div>
              </div>
            </div>

            {inv.due_date && (
              <div style={{ fontSize: 13, color: '#777', marginBottom: 16 }}>
                Срок оплаты: {new Date(inv.due_date).toLocaleDateString('ru-RU')}
              </div>
            )}

            <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>История платежей</div>
            {inv.payments?.length ? (
              <table style={{ width: '100%', fontSize: 13 }}>
                <tbody>
                  {inv.payments.map((p: any, i: number) => (
                    <tr key={i}>
                      <td style={{ color: '#888', padding: '4px 0' }}>{new Date(p.payment_date).toLocaleDateString('ru-RU')}</td>
                      <td style={{ color: '#888' }}>{METHOD_LABEL[p.method] ?? p.method}</td>
                      <td style={{ fontWeight: 600, textAlign: 'right' }}>{p.amount_display}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="field-hint">Платежей ещё не было</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
