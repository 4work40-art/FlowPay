'use client';
import { Fragment, useState } from 'react';
import { api, BulkInvoiceItem } from '@/lib/api';
import RegisterDropzone, { RecognizedRegister } from '@/components/RegisterDropzone';

type EditableRow = {
  row: number;
  include: boolean;
  number: string;
  invoice_date: string;
  due_date: string;
  amountRub: string;
  counterparty_name: string;
  counterparty_inn: string;
  notes: string;
  warnings: string[];
};

type ImportResult = {
  created: { row: number; invoice_id: string; number: string }[];
  failed: { row: number; reason: string }[];
};

function toEditableRows(reg: RecognizedRegister): EditableRow[] {
  return reg.items.map(item => ({
    row: item.row,
    include: item.warnings.length === 0,
    number: item.number ?? '',
    invoice_date: item.invoice_date ?? '',
    due_date: item.due_date ?? '',
    amountRub: item.amount_kopecks != null ? String(item.amount_kopecks / 100) : '',
    counterparty_name: item.counterparty_name ?? '',
    counterparty_inn: item.counterparty_inn ?? '',
    notes: item.notes ?? '',
    warnings: item.warnings,
  }));
}

export default function ImportInvoicesPage() {
  const [summary, setSummary] = useState<{ total_rows: number; parsed_rows: number; warning_rows: number } | null>(null);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const handleRecognized = (reg: RecognizedRegister) => {
    setError('');
    setResult(null);
    setSummary({ total_rows: reg.total_rows, parsed_rows: reg.parsed_rows, warning_rows: reg.warning_rows });
    setRows(toEditableRows(reg));
  };

  const updateRow = (row: number, patch: Partial<EditableRow>) => {
    setRows(prev => prev.map(r => (r.row === row ? { ...r, ...patch } : r)));
  };

  const includedCount = rows.filter(r => r.include).length;

  const submit = async () => {
    setError('');
    setResult(null);
    const selected = rows.filter(r => r.include);
    if (!selected.length) { setError('Выберите хотя бы одну строку для импорта'); return; }

    for (const r of selected) {
      const rub = Number(r.amountRub.replace(',', '.'));
      if (!rub || rub <= 0) {
        setError(`Строка ${r.row}: укажите корректную сумму больше нуля`);
        return;
      }
    }

    setImporting(true);
    try {
      const items: BulkInvoiceItem[] = selected.map(r => ({
        number: r.number || undefined,
        amount_kopecks: Math.round(Number(r.amountRub.replace(',', '.')) * 100),
        counterparty_name: r.counterparty_name || undefined,
        counterparty_inn: r.counterparty_inn || undefined,
        due_date: r.due_date || undefined,
        invoice_date: r.invoice_date || undefined,
        notes: r.notes || undefined,
      }));
      // row в items соответствует индексу переданного массива, а не исходному
      // номеру строки реестра — сопоставляем результат обратно через selected[].row.
      const res = await api.invoices.bulkCreate(items);
      const mapRow = (i: number) => selected[i]?.row ?? i;
      setResult({
        created: res.data.created.map(c => ({ ...c, row: mapRow(c.row) })),
        failed: res.data.failed.map(f => ({ ...f, row: mapRow(f.row) })),
      });
    } catch (e: any) {
      setError(e.message || 'Не удалось импортировать реестр');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Импорт реестра счетов</div>
        <a href="/invoices" className="btn btn-sm">← К списку</a>
      </div>

      {!rows.length && (
        <div style={{ maxWidth: 640 }}>
          <RegisterDropzone onRecognized={handleRecognized} />
        </div>
      )}

      {error && <div className="error-box">{error}</div>}

      {result && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-body">
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Импорт завершён: создано {result.created.length}, не удалось {result.failed.length}
            </div>
            {!!result.created.length && (
              <ul style={{ marginBottom: result.failed.length ? 10 : 0, paddingLeft: 18 }}>
                {result.created.map(c => (
                  <li key={c.invoice_id}>
                    Строка {c.row}: <a href={`/invoices/${c.invoice_id}`}>счёт №{c.number}</a>
                  </li>
                ))}
              </ul>
            )}
            {!!result.failed.length && (
              <div>
                <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--red)' }}>Не импортированы:</div>
                <ul style={{ paddingLeft: 18 }}>
                  {result.failed.map(f => (
                    <li key={f.row}>Строка {f.row}: {f.reason}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="form-actions" style={{ marginTop: 14 }}>
              <a href="/invoices" className="btn btn-primary">К списку счетов</a>
              <button className="btn" onClick={() => { setResult(null); setRows([]); setSummary(null); }}>
                Импортировать ещё один реестр
              </button>
            </div>
          </div>
        </div>
      )}

      {!!rows.length && !result && (
        <>
          {summary && (
            <div style={{ fontSize: 12.5, color: 'var(--text2)', marginBottom: 12 }}>
              Всего строк: {summary.total_rows}, распознано: {summary.parsed_rows}, с предупреждениями: {summary.warning_rows}.
              По умолчанию включены строки без предупреждений — проверьте остальные и поправьте вручную.
            </div>
          )}

          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}></th>
                    <th style={{ width: 40 }}>№ стр.</th>
                    <th>Номер счёта</th>
                    <th>Дата счёта</th>
                    <th>Срок оплаты</th>
                    <th>Сумма, ₽</th>
                    <th>Контрагент</th>
                    <th>ИНН</th>
                    <th>Примечание</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const hasWarnings = r.warnings.length > 0;
                    return (
                      <Fragment key={r.row}>
                        <tr style={hasWarnings ? { background: 'var(--amber-light, #fdf3e0)' } : undefined}>
                          <td>
                            <input type="checkbox" checked={r.include} onChange={e => updateRow(r.row, { include: e.target.checked })} />
                          </td>
                          <td className="mono" style={{ color: '#888' }}>{r.row}</td>
                          <td><input type="text" value={r.number} onChange={e => updateRow(r.row, { number: e.target.value })} style={{ width: 90 }} /></td>
                          <td><input type="date" value={r.invoice_date} onChange={e => updateRow(r.row, { invoice_date: e.target.value })} /></td>
                          <td><input type="date" value={r.due_date} onChange={e => updateRow(r.row, { due_date: e.target.value })} /></td>
                          <td><input type="text" inputMode="decimal" value={r.amountRub} onChange={e => updateRow(r.row, { amountRub: e.target.value })} style={{ width: 100 }} /></td>
                          <td><input type="text" value={r.counterparty_name} onChange={e => updateRow(r.row, { counterparty_name: e.target.value })} style={{ width: 150 }} /></td>
                          <td><input type="text" value={r.counterparty_inn} onChange={e => updateRow(r.row, { counterparty_inn: e.target.value })} style={{ width: 100 }} /></td>
                          <td><input type="text" value={r.notes} onChange={e => updateRow(r.row, { notes: e.target.value })} style={{ width: 140 }} /></td>
                        </tr>
                        {hasWarnings && (
                          <tr style={{ background: 'var(--amber-light, #fdf3e0)' }}>
                            <td></td>
                            <td colSpan={8} style={{ color: '#9a6b00', fontSize: 12, paddingTop: 0 }}>
                              ⚠ {r.warnings.join('; ')}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="table-footer">
              <span>{includedCount} из {rows.length} строк выбрано</span>
              <button className="btn btn-primary" disabled={importing || !includedCount} onClick={submit}>
                {importing ? 'Импортируем…' : `Импортировать выбранные (${includedCount})`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
