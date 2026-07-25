'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';

type BankRequisites = {
  bank_account: string | null;
  bank_corr_account: string | null;
  bank_bik: string | null;
  bank_name: string | null;
};
type Party = ({ inn: string | null; kpp: string | null } & Partial<BankRequisites>) | null;

export type RecognizedInvoiceItem = {
  name: string; quantity: number; unit: string | null;
  unit_price_kopecks: number; amount_kopecks: number;
};
export type RecognizedInvoice = {
  doc_type: 'invoice';
  fields: {
    number: string | null;
    invoice_date: string | null;
    due_date?: string | null;
    amount_kopecks: number | null;
    supplier_name: string | null;
    inn: string | null;
    kpp: string | null;
    ogrn: string | null;
    address: string | null;
    items: RecognizedInvoiceItem[] | null;
  } & Partial<BankRequisites>;
  confidence: number | null;
  // Счёт с таким же номером уже есть у организации — почти наверняка это
  // повторная загрузка того же документа. Новый счёт создавать не нужно,
  // только дозаполнить недостающие поля у существующего.
  existing_invoice: {
    id: string;
    number: string;
    missing: string[];
  } | null;
};
export type RecognizedInvoiceForVat = {
  doc_type: 'invoice_for_vat';
  fields: {
    number: string | null;
    invoice_date: string | null;
    amount_kopecks: number | null;
    seller_name: string | null;
    buyer_name: string | null;
    seller_inn: string | null;
    buyer_inn: string | null;
    kpps: string[];
    vat_rate: number | null;
    vat_kopecks: number | null;
  };
  confidence: number | null;
};
export type RecognizedPaymentOrder = {
  doc_type: 'payment_order';
  fields: {
    number: string | null;
    payment_date: string | null;
    amount_kopecks: number | null;
    purpose: string | null;
    referenced_invoice_number: string | null;
    inns: string[];
    priority: number | null;
    uin: string | null;
    kbk: string | null;
    oktmo: string | null;
    payer: Party;
    payee: Party;
  };
  confidence: number | null;
  matched_invoices: { id: string; number: string; remaining_kopecks: number }[];
  // Платёж с таким же номером/датой/суммой по найденному счёту уже
  // зафиксирован — почти наверняка эта платёжка уже была загружена раньше.
  duplicate: { payment_id: string; invoice_id: string; payment_date: string } | null;
};
export type RecognizedUnknown = { doc_type: 'unknown'; fields: Record<string, any>; confidence: null };
export type Recognized = RecognizedInvoice | RecognizedInvoiceForVat | RecognizedPaymentOrder | RecognizedUnknown;

// Загрузка файла (счёт на оплату / платёжное поручение) с автораспознаванием:
// PDF с текстовым слоем читается напрямую, скан или фото — через OCR,
// Excel/CSV (в том числе устаревший бинарный .xls) — как один документ той
// же логикой, что и PDF: многие учётные системы печатают счёт в файл
// электронной таблицы вместо PDF, и это НЕ реестр из многих счетов (для
// реестра — отдельная страница «Импорт реестра» с табличным разбором).
// Результат — черновик полей, форма ниже должна дать пользователю проверить
// и поправить их перед сохранением: распознавание эвристическое, не 100%-ное.
export default function DocumentDropzone({ onRecognized }: { onRecognized: (r: Recognized) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const res = await api.documents.recognize(file);
      onRecognized(res.data);
    } catch (e: any) {
      setError(e.message || 'Не удалось распознать файл');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="card"
      style={{
        marginBottom: 16, border: dragOver ? '2px dashed var(--accent, #b8860b)' : '2px dashed var(--border, #ddd)',
        background: dragOver ? 'var(--accent-light, #fdf6e8)' : undefined,
      }}
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) handleFile(file);
      }}
    >
      <div className="card-body" style={{ textAlign: 'center', padding: '20px 16px' }}>
        <input
          ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
        />
        {busy ? (
          <div>⏳ Распознаём документ…</div>
        ) : (
          <>
            <div style={{ fontSize: 24, marginBottom: 4 }}>📎</div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>
              Перетащите сюда счёт на оплату или платёжное поручение
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>
              PDF, JPG, PNG или Excel/CSV — поля формы заполнятся автоматически, проверьте перед сохранением
            </div>
            <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>
              Выбрать файл
            </button>
          </>
        )}
        {error && <div className="error-box" style={{ marginTop: 12 }}>{error}</div>}
      </div>
    </div>
  );
}
