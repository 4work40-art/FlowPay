'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, formatDateOnly } from '@/lib/api';
import { downloadCsv, fetchAllPages } from '@/lib/csv';

const PAGE_SIZE = 20;

export default function PaymentsPage() {
  const [payments, setPayments] = useState<any[]>([]);
  const [total,    setTotal]    = useState(0);
  const [page,     setPage]     = useState(1);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo,   setExportTo]   = useState('');
  const [showExport, setShowExport] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<any>(null);
  const [importError, setImportError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // silent=true — обновить список без спиннера (после удаления платежа):
  // иначе таблица на секунду пропадает целиком и ощущается как перезагрузка.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    api.payments.list({ page: String(page), limit: String(PAGE_SIZE) })
      .then(r => { setPayments(r.data?.items ?? []); setTotal(r.data?.total ?? 0); })
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    setImportError(''); setImportResult(null);
    setImporting(true);
    try {
      const res = await api.payments.importBankStatement(file);
      setImportResult(res.data);
      load();
    } catch (e: any) {
      setImportError(e.message || 'Не удалось импортировать выписку');
    } finally {
      setImporting(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (exportFrom) params.from = exportFrom;
      if (exportTo) params.to = exportTo;
      const all = await fetchAllPages<any>(api.payments.list, params);
      downloadCsv(
        `payments_${new Date().toISOString().slice(0, 10)}.csv`,
        ['Дата', 'Счёт', 'Контрагент', 'Сумма, ₽', 'Способ', 'Референс'],
        all.map(p => [p.payment_date, p.invoice_number ?? '', p.counterparty_name ?? '', (p.amount_kopecks / 100).toFixed(2), p.method ?? '', p.reference ?? ''])
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
        <div className="page-title">Платежи</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="btn btn-sm" style={{ cursor: 'pointer' }} title="CSV, Excel-выписка любого банка РФ или файл 1С-обмена (1CClientBankExchange, .txt)">
            {importing ? 'Импортируем…' : '📥 Импорт выписки из банка'}
            <input type="file" accept=".csv,.txt,.xlsx,.xls,text/csv" style={{ display: 'none' }} disabled={importing}
              onChange={e => { onImportFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          </label>
        <div style={{ position: 'relative' }}>
          <button className="btn btn-sm" disabled={!total} onClick={() => setShowExport(v => !v)}>⭳ Экспорт CSV</button>
          {showExport && (
            <div className="card" style={{ position: 'absolute', top: '110%', right: 0, padding: 14, zIndex: 10, width: 260 }}>
              <div className="field-label" style={{ marginBottom: 8 }}>Период (необязательно)</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                <input type="date" value={exportFrom} onChange={e => setExportFrom(e.target.value)} style={{ flex: 1 }} />
                <input type="date" value={exportTo} onChange={e => setExportTo(e.target.value)} style={{ flex: 1 }} />
              </div>
              <button className="btn btn-primary btn-sm" style={{ width: '100%' }} disabled={exporting}
                onClick={() => { exportCsv(); setShowExport(false); }}>
                {exporting ? 'Выгружаем…' : 'Выгрузить'}
              </button>
            </div>
          )}
        </div>
        </div>
      </div>

      {importError && <div className="error-box" style={{ marginBottom: 12 }}>{importError}</div>}
      {importResult && (
        <div className="card" style={{ marginBottom: 16, padding: 14, fontSize: 13 }}>
          Импорт завершён: сопоставлено платежей — <strong>{importResult.matched_count}</strong>,
          не удалось сопоставить — <strong>{importResult.unmatched_count}</strong>,
          уже были загружены ранее — <strong>{importResult.skipped_count}</strong>.
          {importResult.unmatched_count > 0 && (
            <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--text2)' }}>
              {importResult.unmatched.slice(0, 10).map((u: any, i: number) => (
                <li key={i}>{u.raw} — {u.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="error-box">
          {error} <button className="btn btn-sm" onClick={() => load()} style={{ marginLeft: 8 }}>Повторить</button>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="loading">⏳ Загрузка...</div>
        ) : !error && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 110 }}>Дата</th>
                  <th style={{ width: 80 }}>Счёт</th>
                  <th>Контрагент</th>
                  <th style={{ width: 150 }}>Сумма</th>
                  <th style={{ width: 100 }}>ПП</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id}>
                    <td style={{ color: '#888', fontSize: 12 }}>{formatDateOnly(p.payment_date)}</td>
                    <td className="mono" style={{ color: '#888' }}>#{p.invoice_number}</td>
                    <td style={{ fontWeight: 500 }}>{p.counterparty_name || '—'}</td>
                    <td style={{ fontWeight: 600, color: '#085041' }}>{p.amount_display}</td>
                    <td style={{ color: '#888', fontSize: 12 }}>{p.reference || '—'}</td>
                    <td>
                      <button
                        type="button" className="btn btn-sm" disabled={deletingId === p.id}
                        title="Удалить платёж (например, если разнесён по ошибке)"
                        onClick={async () => {
                          if (!confirm(`Удалить платёж на ${p.amount_display} по счёту #${p.invoice_number}? Сумма и статус счёта будут пересчитаны.`)) return;
                          setDeletingId(p.id);
                          // Убираем строку сразу — не ждём ответа сервера, чтобы не было
                          // ощущения перезагрузки страницы; счётчик подправится тихим обновлением.
                          setPayments(prev => prev.filter(x => x.id !== p.id));
                          setTotal(t => Math.max(0, t - 1));
                          try {
                            await api.payments.delete(p.id);
                            load(true);
                          } catch (e: any) {
                            alert(e.message || 'Не удалось удалить платёж');
                            load(true); // откатываем оптимистичное удаление, если запрос не прошёл
                          } finally {
                            setDeletingId(null);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                {!payments.length && (
                  <tr><td colSpan={6} className="empty-state">
                    Платежей пока нет. Записать платёж можно со страницы конкретного счёта.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-footer">
          <span>{total} платежей</span>
          {pages > 1 && (
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Назад</button>
              <span style={{ alignSelf: 'center', fontSize: 12, color: 'var(--text2)' }}>{page} / {pages}</span>
              <button className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Вперёд →</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
