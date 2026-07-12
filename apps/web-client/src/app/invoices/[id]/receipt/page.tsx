'use client';
import { Suspense, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Банковский перевод', cash: 'Наличные', check: 'Чек', online: 'Онлайн-оплата',
};

function ReceiptContent() {
  const { id } = useParams<{ id: string }>();
  const paymentId = useSearchParams().get('payment');
  const [inv, setInv] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.invoices.get(id).then(res => setInv(res.data)).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div style={{ padding: 40 }}>{error}</div>;
  if (!inv) return null;

  const payment = paymentId ? inv.payments?.find((p: any) => p.id === paymentId) : inv.payments?.[0];
  if (!payment) return <div style={{ padding: 40 }}>Платёж не найден</div>;

  return (
    <div style={{ maxWidth: 560, margin: '40px auto', padding: 32, fontFamily: 'sans-serif', color: '#222' }}>
      <style>{`@media print { .no-print { display: none; } }`}</style>

      <div className="no-print" style={{ marginBottom: 24, textAlign: 'right' }}>
        <button onClick={() => window.print()} className="btn btn-primary">🖨 Печать / сохранить как PDF</button>
      </div>

      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Подтверждение оплаты</h1>
      <div style={{ color: '#888', fontSize: 13, marginBottom: 24 }}>Счёт №{inv.number ?? '—'}</div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <tbody>
          <tr><td style={{ padding: '8px 0', color: '#888', width: 180 }}>Контрагент</td><td>{inv.counterparty_name ?? '—'}</td></tr>
          <tr><td style={{ padding: '8px 0', color: '#888' }}>Дата платежа</td><td>{new Date(payment.payment_date).toLocaleDateString('ru-RU')}</td></tr>
          <tr><td style={{ padding: '8px 0', color: '#888' }}>Сумма платежа</td><td style={{ fontWeight: 700 }}>{payment.amount_display}</td></tr>
          <tr><td style={{ padding: '8px 0', color: '#888' }}>Способ оплаты</td><td>{METHOD_LABEL[payment.method] ?? payment.method}</td></tr>
          <tr><td style={{ padding: '8px 0', color: '#888' }}>Сумма счёта</td><td>{inv.amount_display}</td></tr>
          <tr><td style={{ padding: '8px 0', color: '#888' }}>Остаток к оплате</td><td>{inv.remaining_display}</td></tr>
        </tbody>
      </table>

      <div style={{ marginTop: 32, fontSize: 12, color: '#999' }}>
        Документ сформирован автоматически в Счёт&amp;Контроль и не является бухгалтерским документом строгой отчётности.
      </div>
    </div>
  );
}

export default function ReceiptPage() {
  return (
    <Suspense fallback={null}>
      <ReceiptContent />
    </Suspense>
  );
}
