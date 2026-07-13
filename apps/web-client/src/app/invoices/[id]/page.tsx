'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, STATUS_LABEL, STATUS_ICON, STATUS_DESCRIPTION } from '@/lib/api';

type Payment = {
  id: string;
  amount_kopecks: number;
  amount_display: string;
  method: string;
  reference: string | null;
  payment_date: string;
  created_at: string;
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Банковский перевод', cash: 'Наличные', check: 'Чек', online: 'Онлайн-оплата',
};

const TRANSITIONS: Record<string, { label: string; from: string[]; cls: string }> = {
  mark_for_control: { label: '👁 На контроль',      from: ['CREATED'],                                   cls: 'btn-primary' },
  set_pending:      { label: '⏳ Ожидает оплаты',    from: ['UNDER_CONTROL'],                             cls: 'btn-primary' },
  mark_overdue:     { label: '⏰ Отметить просрочку', from: ['PAYMENT_PENDING', 'UNDER_CONTROL'],          cls: 'btn-amber'   },
  open_dispute:     { label: '⚠ Открыть спор',       from: ['PAYMENT_PENDING', 'OVERDUE', 'PARTIALLY_PAID'], cls: 'btn-red'   },
  resolve_dispute:  { label: '✓ Закрыть спор',       from: ['DISPUTED'],                                  cls: 'btn-primary' },
  write_off:        { label: '✗ Списать',            from: ['OVERDUE'],                                   cls: 'btn-amber'   },
  archive:          { label: '📦 В архив',           from: ['PAID'],                                      cls: 'btn-gray'    },
};

type Doc = { id: string; filename: string; mime_type: string; size_bytes: number; created_at: string };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv,     setInv]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [acting,  setActing]  = useState(false);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.invoices.get(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const loadDocs = useCallback(() => {
    api.documents.list(id).then(res => setDocs(res.data?.items ?? [])).catch(() => {});
  }, [id]);

  useEffect(() => { load(); loadDocs(); }, [load, loadDocs]);

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    setDocError('');
    setUploading(true);
    try {
      await api.documents.upload(id, file);
      loadDocs();
    } catch (e: any) {
      setDocError(e.message || 'Не удалось загрузить файл');
    } finally {
      setUploading(false);
    }
  };

  const doTransition = async (key: string) => {
    setActing(true);
    try {
      await api.invoices.transition(id, key);
      load();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!inv) return null;

  const available = Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(inv.status));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Счёт №{inv.number ?? '—'}</div>
          <div className="page-sub">{inv.counterparty_name ?? 'без контрагента'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {inv.public_enabled ? (
            <>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const url = `${window.location.origin}/public/invoice/${id}`;
                  navigator.clipboard?.writeText(url);
                  alert('Ссылка на счёт скопирована — можно отправить контрагенту, регистрация не нужна');
                }}>
                🔗 Поделиться
              </button>
              <button
                className="btn btn-sm"
                title="Публичная ссылка перестанет открываться у контрагента"
                onClick={async () => {
                  try { await api.invoices.setPublic(id, false); setInv({ ...inv, public_enabled: false }); }
                  catch (e: any) { alert(e.message); }
                }}>
                🚫 Закрыть доступ
              </button>
            </>
          ) : (
            <button
              className="btn btn-sm"
              onClick={async () => {
                try { await api.invoices.setPublic(id, true); setInv({ ...inv, public_enabled: true }); }
                catch (e: any) { alert(e.message); }
              }}>
              🔓 Открыть доступ по ссылке
            </button>
          )}
          <a href="/invoices" className="btn btn-sm">← К списку</a>
        </div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 16 }}>
        <div className="metric-card">
          <div className="metric-label">Сумма счёта</div>
          <div className="metric-value">{inv.amount_display}</div>
        </div>
        <div className="metric-card green">
          <div className="metric-label">Оплачено</div>
          <div className="metric-value">{inv.paid_display}</div>
        </div>
        <div className="metric-card amber">
          <div className="metric-label">Остаток</div>
          <div className="metric-value">{inv.remaining_display}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Срок оплаты</div>
          <div className="metric-value" style={{ fontSize: 16 }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ru-RU') : '—'}</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <span className={`status-badge status-${inv.status}`} title={STATUS_DESCRIPTION[inv.status] ?? ''}>
            {STATUS_ICON[inv.status]} {STATUS_LABEL[inv.status] ?? inv.status}
          </span>
          {inv.remaining_kopecks > 0 && !['DISPUTED', 'ARCHIVED', 'WRITTEN_OFF'].includes(inv.status) && (
            <a href={`/payments/new?invoice=${inv.id}`} className="btn btn-green btn-sm">+ Платёж</a>
          )}
        </div>
        {inv.notes && <div className="card-body" style={{ color: 'var(--text2)' }}>{inv.notes}</div>}
        <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: inv.notes ? 0 : undefined }}>
          {available.map(([key, t]) => (
            <button key={key} className={`btn btn-sm ${t.cls}`} disabled={acting} onClick={() => doTransition(key)}>
              {t.label}
            </button>
          ))}
          {!available.length && <span className="field-hint">Для этого статуса действий больше нет.</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          Документы
          <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Загружаем…' : '+ Прикрепить файл'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => { onFileSelected(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
        </div>
        {docError && <div className="error-box" style={{ margin: '0 16px 12px' }}>{docError}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Файл</th>
                <th>Размер</th>
                <th>Загружен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.filename}</td>
                  <td style={{ color: 'var(--text2)' }}>{fmtSize(d.size_bytes)}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{new Date(d.created_at).toLocaleString('ru-RU')}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => api.documents.download(d.id, d.filename)}>Скачать</button>
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr><td colSpan={4} className="empty-state">Файлов пока нет — прикрепите скан или PDF счёта</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="field-hint">Разрешены PDF, JPG, PNG, до 15 МБ. Автоматическое распознавание полей — в следующих обновлениях.</span>
        </div>
      </div>

      <div className="card">
        <div className="card-header">История платежей</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сумма</th>
                <th>Способ</th>
                <th>Референс</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(inv.payments as Payment[] ?? []).map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.payment_date).toLocaleDateString('ru-RU')}</td>
                  <td style={{ fontWeight: 600 }}>{p.amount_display}</td>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td style={{ color: 'var(--text2)' }}>{p.reference ?? '—'}</td>
                  <td>
                    <a className="btn btn-sm" href={`/invoices/${id}/receipt?payment=${p.id}`} target="_blank" rel="noreferrer">Акт</a>
                  </td>
                </tr>
              ))}
              {!inv.payments?.length && (
                <tr><td colSpan={5} className="empty-state">Платежей ещё не было</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
