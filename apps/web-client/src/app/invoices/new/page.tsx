'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import DocumentDropzone, { Recognized } from '@/components/DocumentDropzone';

type Counterparty = { id: string; name: string; inn: string | null };

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
  const [recognizedNotice, setRecognizedNotice] = useState('');
  const [counterpartyNotice, setCounterpartyNotice] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');

  const loadCounterparties = () =>
    api.counterparties.list().then(res => setCounterparties(res.data?.items ?? [])).catch(() => {});

  useEffect(() => { loadCounterparties(); }, []);

  const handleRecognized = async (r: Recognized) => {
    const confidenceNote = r.confidence != null ? ` Уверенность распознавания: ${r.confidence}%.` : '';
    if (r.doc_type === 'payment_order') {
      setRecognizedNotice('В файле похоже на платёжное поручение, а не счёт — если это платёж, зафиксируйте его на странице счёта.');
      return;
    }
    if (r.doc_type === 'unknown') {
      setRecognizedNotice('Не удалось однозначно распознать документ — поля ниже заполнены тем, что удалось найти, проверьте перед сохранением.');
    } else if (r.doc_type === 'invoice_for_vat') {
      setRecognizedNotice(`Это похоже на счёт-фактуру/УПД, а не на обычный счёт на оплату — данные всё равно перенесены в форму, проверьте перед сохранением.${confidenceNote}`);
    } else {
      setRecognizedNotice(`Данные распознаны из файла — проверьте перед сохранением, OCR может ошибаться.${confidenceNote}`);
    }

    const f: any = r.fields;
    if (f.amount_kopecks) setAmount(String(f.amount_kopecks / 100));
    if (f.number) setNumber(f.number);
    if (f.invoice_date) setInvoiceDate(f.invoice_date);
    if (f.due_date) setDueDate(f.due_date);

    // Счёт-фактура/УПД называет стороны "продавец/покупатель", обычный счёт —
    // "поставщик"; приводим к одному имени и ИНН для дальнейшего сопоставления.
    const supplierName = r.doc_type === 'invoice_for_vat' ? f.seller_name : f.supplier_name;
    const inn = r.doc_type === 'invoice_for_vat' ? f.seller_inn : (f.inn ?? f.inns?.[0] ?? null);
    const kpp = r.doc_type === 'invoice_for_vat' ? f.kpps?.[0] : f.kpp;

    // Автоматически подставляем контрагента, чтобы не заставлять пользователя
    // переходить в раздел «Контрагенты»: сначала ищем среди уже существующих
    // по ИНН (надёжнее всего), затем — по названию (без учёта регистра и
    // пробелов, на случай если ИНН распознать не удалось) и только если
    // совпадения нет — создаём нового. Такой порядок исключает дубли даже
    // когда OCR не смог прочитать ИНН.
    setCounterpartyNotice('');
    if (supplierName || inn) {
      const normalizedName = supplierName?.trim().toLowerCase();
      const existing = (inn && counterparties.find(c => c.inn === inn))
        || (normalizedName && counterparties.find(c => c.name.trim().toLowerCase() === normalizedName))
        || null;

      if (existing) {
        setCpId(existing.id);
        setCounterpartyNotice(`Контрагент «${existing.name}» уже есть в списке — выбран автоматически.`);
      } else if (supplierName) {
        try {
          const created = await api.counterparties.create({
            name: supplierName, inn: inn || undefined, kpp: kpp || undefined,
            ogrn: f.ogrn || undefined, address: f.address || undefined,
            bank_account: f.bank_account || undefined, bank_name: f.bank_name || undefined,
            bank_bik: f.bank_bik || undefined, bank_corr_account: f.bank_corr_account || undefined,
          });
          await loadCounterparties();
          setCpId(created.data.id);
          setCounterpartyNotice(`Контрагент «${supplierName}» создан автоматически по данным из файла — проверьте карточку в разделе «Контрагенты».`);
        } catch {
          // ИНН/название/реквизиты не прошли валидацию — не страшно, пользователь выберет контрагента вручную
          setCounterpartyNotice(`Не удалось создать контрагента «${supplierName}» автоматически (реквизиты не прошли проверку) — выберите его вручную или добавьте на странице «Контрагенты».`);
        }
      }
    }
  };

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
        invoice_date: invoiceDate || undefined,
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

      <div style={{ maxWidth: 560 }}>
        <DocumentDropzone onRecognized={handleRecognized} />
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-body">
          <form onSubmit={submit}>
            {recognizedNotice && (
              <div className="error-box" style={{ marginBottom: 14, background: 'var(--blue-light, #eaf2fb)', color: 'var(--blue-dark, #1a5fb4)' }}>
                {recognizedNotice}
              </div>
            )}
            {counterpartyNotice && (
              <div className="error-box" style={{ marginBottom: 14, background: 'var(--green-light, #e8f5ee)', color: 'var(--green-dark, #1a7a4c)' }}>
                {counterpartyNotice}
              </div>
            )}
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
                <label className="field-label">Дата счёта</label>
                <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} />
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
