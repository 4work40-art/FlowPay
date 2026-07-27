'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, fmt } from '@/lib/api';
import DocumentDropzone, { Recognized } from '@/components/DocumentDropzone';

const METHODS = [
  { v: 'bank_transfer', l: 'Банковский перевод' },
  { v: 'cash',          l: 'Наличные'            },
  { v: 'check',         l: 'Чек'                 },
  { v: 'online',        l: 'Онлайн-оплата'       },
];

type InvoiceOption = { id: string; number: string | null; counterparty_name: string | null; remaining_display: string };

export default function NewPaymentPage() {
  const router = useRouter();
  const params = useSearchParams();
  const invoiceId = params.get('invoice') ?? '';

  const [invoice, setInvoice] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [amount,  setAmount]  = useState(params.get('amount') ?? '');
  const [method,  setMethod]  = useState('bank_transfer');
  const [ref,     setRef]     = useState(params.get('ref') ?? '');
  const [date,    setDate]    = useState(() => params.get('date') || new Date().toISOString().slice(0, 10));
  const [error,   setError]   = useState('');
  const [saving,  setSaving]  = useState(false);
  const [recognizedNotice, setRecognizedNotice] = useState('');
  const [duplicateWarning, setDuplicateWarning] = useState('');
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);

  // Пока счёт не выбран: кандидаты по распознанной платёжке или ручной поиск.
  const [candidates, setCandidates] = useState<{ id: string; number: string }[]>([]);
  const [allInvoices, setAllInvoices] = useState<InvoiceOption[]>([]);
  const [manualPick, setManualPick] = useState(false);

  useEffect(() => {
    if (!invoiceId) { setLoading(false); return; }
    api.invoices.get(invoiceId)
      .then(res => setInvoice(res.data))
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [invoiceId]);

  const goToInvoice = (id: string, prefill: { amount?: number; date?: string; ref?: string }) => {
    const qp = new URLSearchParams({ invoice: id });
    if (prefill.amount) qp.set('amount', String(prefill.amount / 100));
    if (prefill.date) qp.set('date', prefill.date);
    if (prefill.ref) qp.set('ref', prefill.ref);
    router.replace(`/payments/new?${qp.toString()}`);
  };

  const applyDuplicateWarning = (r: Recognized) => {
    if ('duplicate' in r && r.duplicate) {
      setDuplicateWarning(
        `Похоже, эта платёжка уже была загружена раньше — платёж с таким же номером, датой и суммой по этому счёту уже зафиксирован (${r.duplicate.payment_date}). ` +
        'Если это действительно другой, отдельный платёж — подтвердите ниже.'
      );
      setConfirmDuplicate(false);
    } else {
      setDuplicateWarning('');
    }
  };

  const handleRecognizedNoInvoice = async (r: Recognized) => {
    applyDuplicateWarning(r);
    if (r.doc_type === 'payment_order') {
      const matched = r.matched_invoices ?? [];
      if (matched.length === 1) {
        goToInvoice(matched[0].id, { amount: r.fields.amount_kopecks ?? undefined, date: r.fields.payment_date ?? undefined, ref: r.fields.number ?? undefined });
        return;
      }
      if (matched.length > 1) {
        setCandidates(matched);
        setRecognizedNotice('Назначение платежа подходит сразу к нескольким счетам — выберите нужный.');
        setAmount(r.fields.amount_kopecks ? String(r.fields.amount_kopecks / 100) : amount);
        if (r.fields.payment_date) setDate(r.fields.payment_date);
        if (r.fields.number) setRef(r.fields.number);
        return;
      }
    }
    // Счёт не нашли автоматически — сохраняем распознанные поля и просим выбрать счёт вручную.
    setRecognizedNotice('Не удалось автоматически найти счёт по этому файлу — выберите его из списка ниже, остальные поля уже заполнены.');
    if (r.fields.amount_kopecks) setAmount(String(r.fields.amount_kopecks / 100));
    const payDate = 'payment_date' in r.fields ? r.fields.payment_date : ('invoice_date' in r.fields ? r.fields.invoice_date : null);
    if (payDate) setDate(payDate);
    if ('number' in r.fields && r.fields.number) setRef(r.fields.number);
    setManualPick(true);
    if (!allInvoices.length) {
      api.invoices.list({ limit: '100' }).then(res => setAllInvoices(res.data?.items ?? [])).catch(() => {});
    }
  };

  const handleRecognizedWithInvoice = (r: Recognized) => {
    setRecognizedNotice('Данные распознаны из файла — проверьте перед сохранением, OCR может ошибаться.');
    applyDuplicateWarning(r);
    if (r.fields.amount_kopecks) setAmount(String(r.fields.amount_kopecks / 100));
    const payDate = 'payment_date' in r.fields ? r.fields.payment_date : null;
    if (payDate) setDate(payDate);
    if ('number' in r.fields && r.fields.number) setRef(r.fields.number);
  };

  if (!invoiceId) {
    return (
      <div>
        <div className="page-header">
          <div className="page-title">Новый платёж</div>
          <a href="/invoices" className="btn btn-sm">← К списку</a>
        </div>

        <div style={{ maxWidth: 480 }}>
          <DocumentDropzone onRecognized={handleRecognizedNoInvoice} />
        </div>

        {recognizedNotice && (
          <div className="error-box" style={{ maxWidth: 480, marginBottom: 16, background: 'var(--blue-light, #eaf2fb)', color: 'var(--blue-dark, #1a5fb4)' }}>
            {recognizedNotice}
          </div>
        )}

        {candidates.length > 0 && (
          <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
            <div className="card-header">Похожие счета — выберите нужный</div>
            <div className="card-body">
              {candidates.map(c => (
                <button key={c.id} type="button" className="btn btn-sm" style={{ marginRight: 8, marginBottom: 8 }}
                  onClick={() => goToInvoice(c.id, { amount: Number(amount.replace(',', '.')) * 100 || undefined, date, ref })}>
                  Счёт №{c.number}
                </button>
              ))}
            </div>
          </div>
        )}

        {manualPick && (
          <div className="card" style={{ maxWidth: 480, marginBottom: 16 }}>
            <div className="card-header">Выберите счёт</div>
            <div className="card-body">
              <select onChange={e => { if (e.target.value) goToInvoice(e.target.value, { amount: Number(amount.replace(',', '.')) * 100 || undefined, date, ref }); }} defaultValue="">
                <option value="">— выберите счёт —</option>
                {allInvoices.map(i => (
                  <option key={i.id} value={i.id}>
                    №{i.number ?? '—'} · {i.counterparty_name ?? 'без контрагента'} · остаток {i.remaining_display}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="card" style={{ maxWidth: 480 }}>
          <div className="card-body">
            <p>Или выберите счёт вручную из списка счетов.</p>
            <a href="/invoices" className="btn btn-primary" style={{ marginTop: 12 }}>К списку счетов</a>
          </div>
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
    if (duplicateWarning && !confirmDuplicate) {
      setError('Подтвердите, что это другой платёж, прежде чем продолжить.');
      return;
    }

    setSaving(true);
    try {
      await api.payments.create({
        invoice_id: invoiceId,
        amount_kopecks: Math.round(rub * 100),
        method, reference: ref || undefined, payment_date: date,
        force: confirmDuplicate || undefined,
      });
      router.replace(`/invoices/${invoiceId}`);
    } catch (e: any) {
      // Подстраховка на случай, если предупреждение при распознавании не
      // сработало (например, платёж введён вручную без файла) — сервер всё
      // равно проверяет дубль при сохранении.
      if (e.code === 'DUPLICATE_PAYMENT') {
        setDuplicateWarning(e.message);
        setConfirmDuplicate(false);
      }
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

      <div style={{ maxWidth: 480 }}>
        <DocumentDropzone onRecognized={handleRecognizedWithInvoice} />
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <div className="card-body">
          <form onSubmit={submit}>
            {recognizedNotice && (
              <div className="error-box" style={{ marginBottom: 14, background: 'var(--blue-light, #eaf2fb)', color: 'var(--blue-dark, #1a5fb4)' }}>
                {recognizedNotice}
              </div>
            )}
            {duplicateWarning && (
              <div className="error-box" style={{ marginBottom: 14 }}>
                <div style={{ marginBottom: 8 }}>⚠️ {duplicateWarning}</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, cursor: 'pointer' }}>
                  <input type="checkbox" checked={confirmDuplicate} onChange={e => setConfirmDuplicate(e.target.checked)} />
                  Это другой платёж — провести всё равно
                </label>
              </div>
            )}
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
              <button type="submit" className="btn btn-green" disabled={saving || (!!duplicateWarning && !confirmDuplicate)}>
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
