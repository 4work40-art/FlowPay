'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

type Counterparty = { id: string; name: string };

export default function NewInvoicePage() {
  const router = useRouter();
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [amount,   setAmount]   = useState('');
  const [number,   setNumber]   = useState('');
  const [cpId,     setCpId]     = useState('');
  const [dueDate,  setDueDate]  = useState('');
  const [notes,    setNotes]    = useState('');
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);

  useEffect(() => {
    api.counterparties.list()
      .then(res => setCounterparties(res.data?.items ?? []))
      .catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const rub = Number(amount.replace(',', '.'));
    if (!rub || rub <= 0) { setError('Укажите сумму больше нуля'); return; }

    setSaving(true);
    try {
      const res = await api.invoices.create({
        amount_kopecks: Math.round(rub * 100),
        number: number || undefined,
        counterparty_id: cpId || undefined,
        due_date: dueDate || undefined,
        notes: notes || undefined,
      });
      router.replace(`/invoices/${res.data.id}`);
    } catch (e: any) {
      setError(e.message || 'Не удалось создать счёт');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Новый счёт</div>
        <a href="/invoices" className="btn btn-sm">← К списку</a>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <form onSubmit={submit}>
            {error && <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>}

            <div className="form-grid">
              <div className="form-group">
                <label className="field-label">Сумма, ₽ *</label>
                <input
                  type="text" inputMode="decimal" required autoFocus
                  placeholder="150000"
                  value={amount} onChange={e => setAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="field-label">Номер счёта</label>
                <input type="text" placeholder="126" value={number} onChange={e => setNumber(e.target.value)} />
              </div>

              <div className="form-group full">
                <label className="field-label">Контрагент</label>
                <select value={cpId} onChange={e => setCpId(e.target.value)}>
                  <option value="">— не выбран —</option>
                  {counterparties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!counterparties.length && (
                  <span className="field-hint">Нет контрагентов — можно <a href="/counterparties">добавить</a> или оставить пустым.</span>
                )}
              </div>

              <div className="form-group">
                <label className="field-label">Срок оплаты</label>
                <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>

              <div className="form-group full">
                <label className="field-label">Примечание</label>
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Создать счёт'}
              </button>
              <a href="/invoices" className="btn">Отмена</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
