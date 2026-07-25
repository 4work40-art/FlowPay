'use client';
import { useEffect, useState } from 'react';
import { Download, BarChart3, FolderUp, Plus, ArrowLeft } from 'lucide-react';
import { api, STATUS_LABEL, STATUS_DESCRIPTION, formatDateOnly } from '@/lib/api';
import { downloadCsv, fetchAllPages } from '@/lib/csv';

function statusTagClass(status: string) {
  if (status === 'OVERDUE' || status === 'DISPUTED') return 'tag tag-accent';
  if (status === 'PAID' || status === 'PARTIALLY_PAID' || status === 'PAYMENT_PENDING') return 'tag tag-outline';
  return 'tag tag-neutral';
}

const FILTERS: [string, string][] = [
  ['', 'Все'],
  ['OVERDUE', 'Просрочены'],
  ['PARTIALLY_PAID', 'Частично'],
  ['UNDER_CONTROL', 'На контроле'],
  ['PAID', 'Оплачены'],
  ['CREATED', 'Созданы'],
];

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [status,   setStatus]   = useState('');
  const [query,    setQuery]    = useState('');
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo,   setExportTo]   = useState('');
  const [showExport, setShowExport] = useState(false);

  const load = () => {
    setLoading(true); setError('');
    api.invoices.list(status ? { status } : {})
      .then(r => setInvoices(r.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  const filtered = query
    ? invoices.filter(inv =>
        String(inv.number ?? '').toLowerCase().includes(query.toLowerCase()) ||
        String(inv.counterparty_name ?? '').toLowerCase().includes(query.toLowerCase()))
    : invoices;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (status) params.status = status;
      if (exportFrom) params.from = exportFrom;
      if (exportTo) params.to = exportTo;
      const all = await fetchAllPages<any>(api.invoices.list, params);
      downloadCsv(
        `invoices_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Номер', 'Контрагент', 'Сумма, ₽', 'Оплачено, ₽', 'Остаток, ₽', 'Срок оплаты', 'Статус'],
        all.map(inv => [
          inv.number ?? '', inv.counterparty_name ?? '',
          (inv.amount_kopecks / 100).toFixed(2), (inv.paid_kopecks / 100).toFixed(2), (inv.remaining_kopecks / 100).toFixed(2),
          inv.due_date ?? '', STATUS_LABEL[inv.status] ?? inv.status,
        ])
      );
    } catch (e: any) {
      alert('Не удалось выгрузить CSV: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Счета</div>
        <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowExport(v => !v)}>
            <Download size={14} strokeWidth={1.5} /> Экспорт CSV
          </button>
          <a href="/invoices/import" className="btn btn-secondary btn-sm">
            <BarChart3 size={14} strokeWidth={1.5} /> Импорт реестра
          </a>
          <a href="/invoices/import-files" className="btn btn-secondary btn-sm">
            <FolderUp size={14} strokeWidth={1.5} /> Массовая загрузка
          </a>
          <a href="/invoices/new" className="btn btn-primary blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <Plus size={14} strokeWidth={1.5} /> Загрузить счёт
          </a>
          {showExport && (
            <div className="card blueprint" style={{ position: 'absolute', top: '110%', right: 0, padding: 14, zIndex: 10, width: 260, background: 'var(--color-bg)' }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              <div className="field-label" style={{ marginBottom: 8 }}>Период (необязательно)</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input className="input" type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={{ flex: 1 }} />
                <input className="input" type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} style={{ flex: 1 }} />
              </div>
              <button className="btn btn-primary btn-sm btn-full" disabled={exporting}
                onClick={() => { exportCsv(); setShowExport(false); }}>
                {exporting ? 'Выгружаем…' : 'Выгрузить'}
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="seg">
          {FILTERS.map(([v, l]) => (
            <label key={v} className="seg-opt">
              <input type="radio" name="invoice-status" checked={status === v} onChange={() => setStatus(v)} />
              {l}
            </label>
          ))}
        </div>
        <input
          className="input" type="text" placeholder="Поиск по номеру или контрагенту…"
          style={{ maxWidth: 260, marginLeft: 'auto' }}
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="error-box">
          {error} <button className="btn btn-sm" onClick={load} style={{ marginLeft: 8 }}>Повторить</button>
        </div>
      )}

      <div className="card blueprint">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        {loading ? (
          <div className="loading">Загрузка…</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>№</th>
                  <th>Контрагент</th>
                  <th style={{ width: 150 }}>Сумма</th>
                  <th style={{ width: 130 }}>Срок оплаты</th>
                  <th style={{ width: 150 }}>Статус</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} className="clickable"
                    onClick={() => window.location.href = `/invoices/${inv.id}`}>
                    <td className="mono text-muted">#{inv.number}</td>
                    <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                    <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{formatDateOnly(inv.due_date)}</td>
                    <td>
                      <span className={statusTagClass(inv.status)} title={STATUS_DESCRIPTION[inv.status] ?? ''}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {!filtered.length && !invoices.length && (
                  <tr><td colSpan={5} className="empty-state">
                    Счетов пока нет. <a href="/invoices/new">Загрузить первый счёт →</a>
                  </td></tr>
                )}
                {!filtered.length && !!invoices.length && (
                  <tr><td colSpan={5} className="empty-state">Ничего не найдено</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{filtered.length} из {invoices.length} счетов</span>
          <a href="/dashboard" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><ArrowLeft size={13} strokeWidth={1.5} /> Дашборд</a>
        </div>
      </div>
    </div>
  );
}
