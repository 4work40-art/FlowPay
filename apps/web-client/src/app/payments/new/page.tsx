'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmt } from '@/lib/api';

const METHODS = [
  { v: 'bank_transfer', l: 'Банковский перевод' },
  { v: 'cash',          l: 'Наличные'            },
  { v: 'check',         l: 'Чек'                 },
  { v: 'online',        l: 'Онлайн-оплата'       },
];

export default function NewPaymentPage() {
  const router = useRouter();
  const invoiceId = useSearchParams().get('invoice') ?? '';

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [amount,  setAmount]  = useState('');
  const [method,  setMethod]  = useState('bank_transfer');
  const [ref,     setRef]     = useState('');
  const [date,    setDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    if (!invoiceId) { setLoading(false); return; }
    api.invoices.get(invoiceId)
      .then(res => setInvoice(res.data))
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  if (!invoiceId) {
    return (
      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-body">
          <p>Сначала выберите счёт, по которому вносите платёж.</p>
          <a href="/invoices" className="btn btn-primary" style={{ marginTop: 12 }}>К списку счетов</a>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (loadError) return <div className="error-box"><strong>Ошибка:</strong> {loadError}</div>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const rub = Number(amount.replace(',', '.'));
    if (!rub || rub <= 0) { setError('Укажите сумму больше нуля'); return; }

    setSaving(true);
    try {
      await api.payments.create({
        invoice_id: invoiceId,
        amount_kopecks: Math.round(rub * 100),
        method, reference: ref || undefined, payment_date: date,
      });
      router.replace(`/invoices/${invoiceId}`);
    } catch (e: any) {
      setError(e.message || 'Не удалось зафиксировать платёж');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Новый платёж</div>
        <a href={`/invoices/${invoiceId}`} className="btn btn-sm">← К счёту</a>
      </div>

      <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
        <div className="card-body" style={{ display: 'flex', justifyContent: 'space-between' }}>
          <div>
            <div className="field-label">Счёт №{invoice.number ?? '—'} · {invoice.counterparty_name ?? 'без контрагента'}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{invoice.amount_display}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="field-label">Остаток к оплате</div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--amber-dark)' }}>{invoice.remaining_display}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-body">
          <form onSubmit={submit}>
            {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

            <div className="form-group">
              <label className="field-label">Сумма, ₽ *</label>
              <input type="text" inputMode="decimal" required autoFocus value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="field-label">Способ оплаты</label>
              <select value={method} onChange={e => setMethod(e.target.value)}>
                {METHODS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="field-label">Номер платёжки / референс</label>
              <input type="text" placeholder="ПП-45" value={ref} onChange={e => setRef(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="field-label">Дата платежа</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} />
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-green" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Зафиксировать платёж'}
              </button>
              <a href={`/invoices/${invoiceId}`} className="btn">Отмена</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
