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
  } & Partial<BankRequisites>;
  confidence: number | null;
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
};
export type RecognizedUnknown = { doc_type: 'unknown'; fields: Record<string, any>; confidence: null };
export type Recognized = RecognizedInvoice | RecognizedInvoiceForVat | RecognizedPaymentOrder | RecognizedUnknown;

// Загрузка файла (счёт на оплату / платёжное поручение) с автораспознаванием:
// PDF с текстовым слоем читается напрямую, скан или фото — через OCR.
// Результат — черновик полей, форма ниже должна дать пользователю проверить
// и поправить их перед сохранением: распознавание эвристическое, не 100%-ное.
const EXCEL_EXT = /\.(xlsx|xls|csv)$/i;

// Доля непустых полей — тот же принцип, что и confidence на бэкенде для
// PDF/фото, только здесь считаем на клиенте, так как строка реестра уже
// пришла в готовом виде из recognize-register.
function excelRowConfidence(row: { number: any; invoice_date: any; amount_kopecks: any; counterparty_name: any; counterparty_inn: any }) {
  const fields = [row.number, row.invoice_date, row.amount_kopecks, row.counterparty_name, row.counterparty_inn];
  return Math.round((fields.filter(v => v !== null && v !== undefined).length / fields.length) * 100);
}

export default function DocumentDropzone({ onRecognized }: { onRecognized: (r: Recognized) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      // Excel/CSV — это не скан счёта, а таблица (Excel-выгрузка счёта из 1С
      // тоже часто содержит всего одну строку данных — распознаём её как
      // обычный счёт; реестр из нескольких строк — не файл для этой формы,
      // отправляем на страницу пакетного импорта, а не гадаем, какая строка нужна).
      if (EXCEL_EXT.test(file.name)) {
        const res = await api.documents.recognizeRegister(file);
        const items = res.data.items;
        if (items.length > 1) {
          setError(`В файле ${items.length} строк — это похоже на реестр счетов, а не на один счёт. Загрузите его на странице «Импорт реестра».`);
          return;
        }
        const row = items[0];
        const recognized: RecognizedInvoice = {
          doc_type: 'invoice',
          fields: {
            number: row.number, invoice_date: row.invoice_date, due_date: row.due_date,
            amount_kopecks: row.amount_kopecks, supplier_name: row.counterparty_name,
            inn: row.counterparty_inn, kpp: null, ogrn: null, address: null,
          },
          confidence: excelRowConfidence(row),
        };
        onRecognized(recognized);
        return;
      }

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
