'use client';
import { useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { InvoiceItemInput } from '@/lib/api';

type Counterparty = { id: string; name: string; inn: string | null };

type BatchRow = {
  filename: string;
  ok: boolean;
  error?: string;
  doc_type?: string;
  include: boolean;
  status: string; // сообщение для строки: что распознано / что не так
  number: string;
  invoiceDate: string;
  dueDate: string;
  amountRub: string;
  counterpartyId: string;
  counterpartyName: string;
  items: InvoiceItemInput[];
  existingInvoiceId: string | null;
  existingInvoiceMissing: string[];
};

const MAX_FILES = 20;

function fieldsFromResult(r: any): { number: string; invoiceDate: string; dueDate: string; amountRub: string; supplierName: string; inn: string | null; kpp: string | null; items: InvoiceItemInput[] } {
  const f = r.fields || {};
  const isVat = r.doc_type === 'invoice_for_vat';
  return {
    number: f.number || '',
    invoiceDate: f.invoice_date || '',
    dueDate: f.due_date || '',
    amountRub: f.amount_kopecks ? String(f.amount_kopecks / 100) : '',
    supplierName: isVat ? (f.seller_name || '') : (f.supplier_name || ''),
    inn: isVat ? (f.seller_inn || null) : (f.inn ?? f.inns?.[0] ?? null),
    kpp: isVat ? (f.kpps?.[0] || null) : (f.kpp || null),
    items: Array.isArray(f.items) ? f.items.map((it: any) => ({
      name: it.name, quantity: it.quantity, unit: it.unit || undefined, unit_price_kopecks: it.unit_price_kopecks,
    })) : [],
  };
}

export default function ImportInvoiceFilesPage() {
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<{ created: number; filled: number; failed: { filename: string; reason: string }[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadCounterparties = async () => {
    try {
      const res = await api.counterparties.list();
      const list: Counterparty[] = res.data?.items ?? [];
      setCounterparties(list);
      return list;
    } catch {
      return [];
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, MAX_FILES);
    if (!list.length) return;
    setError('');
    setCreateResult(null);
    setBusy(true);
    try {
      const [res, cps] = await Promise.all([api.documents.recognizeBatch(list), loadCounterparties()]);
      const results: any[] = res.data?.results ?? [];

      const newRows: BatchRow[] = [];
      for (const r of results) {
        if (r.error) {
          newRows.push({
            filename: r.filename, ok: false, error: r.error, include: false, status: r.error,
            number: '', invoiceDate: '', dueDate: '', amountRub: '', counterpartyId: '', counterpartyName: '',
            items: [], existingInvoiceId: null, existingInvoiceMissing: [],
          });
          continue;
        }
        if (r.doc_type !== 'invoice' && r.doc_type !== 'invoice_for_vat') {
          newRows.push({
            filename: r.filename, ok: false, include: false,
            status: r.doc_type === 'payment_order'
              ? 'Похоже на платёжное поручение, а не счёт — пропущено'
              : 'Не удалось распознать как счёт — пропущено',
            doc_type: r.doc_type,
            number: '', invoiceDate: '', dueDate: '', amountRub: '', counterpartyId: '', counterpartyName: '',
            items: [], existingInvoiceId: null, existingInvoiceMissing: [],
          });
          continue;
        }

        const f = fieldsFromResult(r);
        const normalizedName = f.supplierName?.trim().toLowerCase();
        const existingCp = (f.inn && cps.find(c => c.inn === f.inn))
          || (normalizedName && cps.find(c => c.name.trim().toLowerCase() === normalizedName))
          || null;

        newRows.push({
          filename: r.filename, ok: true, include: !r.existing_invoice,
          status: r.existing_invoice
            ? `Счёт №${r.existing_invoice.number} уже есть — будут дозаполнены только недостающие поля`
            : (r.confidence != null ? `Распознано, уверенность ${r.confidence}%` : 'Распознано'),
          doc_type: r.doc_type,
          number: f.number, invoiceDate: f.invoiceDate, dueDate: f.dueDate, amountRub: f.amountRub,
          counterpartyId: existingCp?.id || '', counterpartyName: f.supplierName || '',
          items: f.items,
          existingInvoiceId: r.existing_invoice?.id || null,
          existingInvoiceMissing: r.existing_invoice?.missing || [],
        });
      }
      setRows(newRows);
    } catch (e: any) {
      setError(e.message || 'Не удалось распознать файлы');
    } finally {
      setBusy(false);
    }
  };

  const updateRow = (i: number, patch: Partial<BatchRow>) => {
    setRows(prev => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const includedCount = rows.filter(r => r.include).length;

  const submit = async () => {
    setError('');
    setCreateResult(null);
    const selected = rows.map((r, i) => ({ r, i })).filter(x => x.r.include);
    if (!selected.length) { setError('Выберите хотя бы одну строку для создания'); return; }

    setCreating(true);
    let created = 0, filled = 0;
    const failed: { filename: string; reason: string }[] = [];

    // Разные строки с одинаковым (по ИНН/названию) новым поставщиком не должны
    // создавать дубли контрагента — заводим нового поставщика максимум один
    // раз за весь пакет и переиспользуем id для остальных строк.
    const createdCpByKey = new Map<string, string>();

    for (const { r, i } of selected) {
      try {
        let counterpartyId = r.counterpartyId || undefined;
        if (!counterpartyId && r.counterpartyName) {
          const key = r.counterpartyName.trim().toLowerCase();
          if (createdCpByKey.has(key)) {
            counterpartyId = createdCpByKey.get(key);
          } else {
            try {
              const cpRes = await api.counterparties.create({ name: r.counterpartyName });
              counterpartyId = cpRes.data.id;
              createdCpByKey.set(key, counterpartyId!);
            } catch {
              // реквизиты не прошли валидацию — создаём счёт без привязки к контрагенту
            }
          }
        }

        if (r.existingInvoiceId) {
          await api.invoices.fillMissing(r.existingInvoiceId, {
            invoice_date: r.invoiceDate || undefined,
            due_date: r.dueDate || undefined,
            items: r.items.length ? r.items : undefined,
          });
          filled++;
        } else {
          const rub = Number(r.amountRub.replace(',', '.'));
          if (!rub || rub <= 0) { failed.push({ filename: r.filename, reason: 'Сумма не распознана или равна нулю' }); continue; }
          await api.invoices.create({
            amount_kopecks: Math.round(rub * 100),
            number: r.number || undefined,
            counterparty_id: counterpartyId,
            due_date: r.dueDate || undefined,
            invoice_date: r.invoiceDate || undefined,
            items: r.items.length ? r.items : undefined,
          });
          created++;
        }
      } catch (e: any) {
        failed.push({ filename: r.filename, reason: e.message || 'Не удалось сохранить' });
      }
    }

    setCreateResult({ created, filled, failed });
    setCreating(false);
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Массовая загрузка счетов</div>
        <a href="/invoices" className="btn btn-sm">← К списку</a>
      </div>

      {!rows.length && (
        <div
          className="card"
          style={{
            marginBottom: 16, maxWidth: 640, border: dragOver ? '2px dashed var(--accent, #b8860b)' : '2px dashed var(--border, #ddd)',
            background: dragOver ? 'var(--accent-light, #fdf6e8)' : undefined,
          }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files); }}
        >
          <div className="card-body" style={{ textAlign: 'center', padding: '20px 16px' }}>
            <input
              ref={inputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.xlsx,.xls,.csv" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) handleFiles(e.target.files); e.target.value = ''; }}
            />
            {busy ? (
              <div>⏳ Распознаём файлы…</div>
            ) : (
              <>
                <div style={{ fontSize: 24, marginBottom: 4 }}>📁</div>
                <div style={{ fontWeight: 500, marginBottom: 4 }}>
                  Перетащите сюда сразу несколько счетов (до {MAX_FILES} файлов)
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 10 }}>
                  PDF, JPG, PNG или Excel/CSV — каждый файл будет распознан как отдельный счёт той же логикой,
                  что и при загрузке одного файла (контрагент и позиции подставятся автоматически)
                </div>
                <button type="button" className="btn btn-sm" onClick={() => inputRef.current?.click()}>
                  Выбрать файлы
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}

      {createResult && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Готово: создано новых счетов — {createResult.created}, дозаполнено существующих — {createResult.filled}, не удалось — {createResult.failed.length}
            </div>
            {!!createResult.failed.length && (
              <ul style={{ paddingLeft: 18, color: 'var(--red)' }}>
                {createResult.failed.map((f, i) => <li key={i}>{f.filename}: {f.reason}</li>)}
              </ul>
            )}
            <div className="form-actions" style={{ marginTop: 14 }}>
              <a href="/invoices" className="btn btn-primary">К списку счетов</a>
              <button className="btn" onClick={() => { setRows([]); setCreateResult(null); }}>
                Загрузить ещё
              </button>
            </div>
          </div>
        </div>
      )}

      {!!rows.length && !createResult && (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Файл</th>
                  <th>Номер</th>
                  <th>Дата счёта</th>
                  <th>Срок оплаты</th>
                  <th>Сумма, ₽</th>
                  <th>Контрагент</th>
                  <th>Позиций</th>
                  <th>Статус</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={!r.ok ? { opacity: 0.55 } : undefined}>
                    <td>
                      <input type="checkbox" checked={r.include} disabled={!r.ok}
                        onChange={e => updateRow(i, { include: e.target.checked })} />
                    </td>
                    <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.filename}>{r.filename}</td>
                    <td><input type="text" value={r.number} disabled={!r.ok} onChange={e => updateRow(i, { number: e.target.value })} style={{ width: 80 }} /></td>
                    <td><input type="date" value={r.invoiceDate} disabled={!r.ok} onChange={e => updateRow(i, { invoiceDate: e.target.value })} /></td>
                    <td><input type="date" value={r.dueDate} disabled={!r.ok} onChange={e => updateRow(i, { dueDate: e.target.value })} /></td>
                    <td><input type="text" inputMode="decimal" value={r.amountRub} disabled={!r.ok} onChange={e => updateRow(i, { amountRub: e.target.value })} style={{ width: 90 }} /></td>
                    <td>
                      <select value={r.counterpartyId} disabled={!r.ok} onChange={e => updateRow(i, { counterpartyId: e.target.value })} style={{ maxWidth: 160 }}>
                        <option value="">{r.counterpartyName ? `+ создать «${r.counterpartyName}»` : '— не выбран —'}</option>
                        {counterparties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </td>
                    <td>{r.items.length || '—'}</td>
                    <td style={{ fontSize: 12, color: r.existingInvoiceId ? 'var(--amber-dark, #a06a00)' : (r.ok ? 'var(--text2)' : 'var(--red)') }}>
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-footer">
            <span>{includedCount} из {rows.length} файлов выбрано</span>
            <button className="btn btn-primary" disabled={creating || !includedCount} onClick={submit}>
              {creating ? 'Создаём…' : `Создать выбранные (${includedCount})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
