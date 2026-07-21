'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';

export type RecognizedInvoice = {
  doc_type: 'invoice';
  fields: {
    number: string | null;
    invoice_date: string | null;
    amount_kopecks: number | null;
    supplier_name: string | null;
    inn: string | null;
    kpp: string | null;
  };
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
  };
  matched_invoices: { id: string; number: string; remaining_kopecks: number }[];
};
export type RecognizedUnknown = { doc_type: 'unknown'; fields: Record<string, any> };
export type Recognized = RecognizedInvoice | RecognizedPaymentOrder | RecognizedUnknown;

// Загрузка файла (счёт на оплату / платёжное поручение) с автораспознаванием:
// PDF с текстовым слоем читается напрямую, скан или фото — через OCR.
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
          ref={inputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
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
              PDF, JPG или PNG — поля формы заполнятся автоматически, проверьте перед сохранением
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
