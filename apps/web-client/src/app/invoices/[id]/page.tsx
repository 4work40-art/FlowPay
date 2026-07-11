'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, STATUS_LABEL, STATUS_ICON } from '@/lib/api';

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

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv,     setInv]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [acting,  setActing]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.invoices.get(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

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
        <a href="/invoices" className="btn btn-sm">← К списку</a>
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
          <span className={`status-badge status-${inv.status}`}>
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
              </tr>
            </thead>
            <tbody>
              {(inv.payments as Payment[] ?? []).map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.payment_date).toLocaleDateString('ru-RU')}</td>
                  <td style={{ fontWeight: 600 }}>{p.amount_display}</td>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td style={{ color: 'var(--text2)' }}>{p.reference ?? '—'}</td>
                </tr>
              ))}
              {!inv.payments?.length && (
                <tr><td colSpan={4} className="empty-state">Платежей ещё не было</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
