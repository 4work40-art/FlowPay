'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Link2, Ban, Unlock, Upload, Plus, X } from 'lucide-react';
import { api, STATUS_LABEL, STATUS_DESCRIPTION } from '@/lib/api';

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

const TRANSITIONS: Record<string, { label: string; from: string[] }> = {
  mark_for_control: { label: 'На контроль',      from: ['CREATED'] },
  set_pending:      { label: 'Ожидает оплаты',    from: ['UNDER_CONTROL'] },
  mark_overdue:     { label: 'Отметить просрочку', from: ['PAYMENT_PENDING', 'UNDER_CONTROL'] },
  open_dispute:     { label: 'Открыть спор',       from: ['PAYMENT_PENDING', 'OVERDUE', 'PARTIALLY_PAID'] },
  resolve_dispute:  { label: 'Закрыть спор',       from: ['DISPUTED'] },
  write_off:        { label: 'Списать',            from: ['OVERDUE'] },
  archive:          { label: 'В архив',            from: ['PAID'] },
};

type Doc = { id: string; filename: string; mime_type: string; size_bytes: number; created_at: string };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

function tagClass(status: string) {
  if (status === 'OVERDUE' || status === 'DISPUTED') return 'tag tag-accent';
  if (status === 'PAID' || status === 'PARTIALLY_PAID' || status === 'PAYMENT_PENDING') return 'tag tag-outline';
  return 'tag tag-neutral';
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv,     setInv]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [acting,  setActing]  = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState('');

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    api.invoices.get(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
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

  if (loading) return <div className="loading">Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!inv) return null;

  const available = Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(inv.status));

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title" style={{ fontSize: 28 }}>Счёт №{inv.number ?? '—'}</h1>
          <div className="page-sub">{inv.counterparty_name ?? 'без контрагента'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {inv.public_enabled ? (
            <>
              <button
                type="button" className="btn btn-secondary blueprint btn-sm"
                onClick={() => {
                  const url = `${window.location.origin}/public/invoice/${id}`;
                  navigator.clipboard?.writeText(url);
                  alert('Ссылка на счёт скопирована — можно отправить контрагенту, регистрация не нужна');
                }}>
                <Corners /><Link2 size={14} strokeWidth={1.5} /> Поделиться
              </button>
              <button
                type="button" className="btn btn-secondary blueprint btn-sm"
                title="Публичная ссылка перестанет открываться у контрагента"
                onClick={async () => {
                  try { await api.invoices.setPublic(id, false); setInv({ ...inv, public_enabled: false }); }
                  catch (e: any) { alert(e.message); }
                }}>
                <Corners /><Ban size={14} strokeWidth={1.5} /> Закрыть доступ
              </button>
            </>
          ) : (
            <button
              type="button" className="btn btn-secondary blueprint btn-sm"
              onClick={async () => {
                try { await api.invoices.setPublic(id, true); setInv({ ...inv, public_enabled: true }); }
                catch (e: any) { alert(e.message); }
              }}>
              <Corners /><Unlock size={14} strokeWidth={1.5} /> Открыть доступ по ссылке
            </button>
          )}
          <a href="/invoices" className="btn btn-ghost btn-sm">← К списку</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', border: '1px solid var(--color-divider)', marginBottom: 20 }}>
        <div style={{ padding: '16px 18px', borderRight: '1px solid var(--color-divider)' }}>
          <div className="metric-label">Сумма счёта</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600 }}>{inv.amount_display}</div>
        </div>
        <div style={{ padding: '16px 18px', borderRight: '1px solid var(--color-divider)' }}>
          <div className="metric-label">Оплачено</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600 }}>{inv.paid_display}</div>
        </div>
        <div style={{ padding: '16px 18px', borderRight: '1px solid var(--color-divider)' }}>
          <div className="metric-label">Остаток</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24, fontWeight: 600, color: 'var(--color-accent-700)' }}>{inv.remaining_display}</div>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <div className="metric-label">Срок оплаты</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 18, fontWeight: 600 }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ru-RU') : '—'}</div>
        </div>
      </div>

      <div className="card blueprint" style={{ position: 'relative', marginBottom: 20, padding: 0 }}>
        <Corners />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: '1px solid var(--color-divider)', flexWrap: 'wrap', gap: 10 }}>
          <span className={tagClass(inv.status)} title={STATUS_DESCRIPTION[inv.status] ?? ''}>
            {STATUS_LABEL[inv.status] ?? inv.status}
          </span>
          {inv.remaining_kopecks > 0 && !['DISPUTED', 'ARCHIVED', 'WRITTEN_OFF'].includes(inv.status) && (
            <a href={`/payments/new?invoice=${inv.id}`} className="btn btn-primary blueprint btn-sm"><Corners /><Plus size={13} strokeWidth={1.5} /> Платёж</a>
          )}
        </div>
        {inv.notes && <div style={{ padding: '14px 18px', color: 'var(--color-neutral-700)' }}>{inv.notes}</div>}
        <div style={{ padding: '14px 18px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {available.map(([key, t]) => (
            <button key={key} type="button" className="btn btn-secondary blueprint btn-sm" disabled={acting} onClick={() => doTransition(key)}>
              <Corners />{t.label}
            </button>
          ))}
          {!available.length && <span className="field-hint">Для этого статуса действий больше нет.</span>}
        </div>
      </div>

      <div className="section-title">Документы</div>
      <div className="card blueprint" style={{ position: 'relative', marginBottom: 20, padding: 0 }}>
        <Corners />
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 18px', borderBottom: '1px solid var(--color-divider)' }}>
          <label className="btn btn-primary blueprint btn-sm" style={{ cursor: 'pointer' }}>
            <Corners /><Upload size={14} strokeWidth={1.5} /> {uploading ? 'Загружаем…' : 'Прикрепить файл'}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => { onFileSelected(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
        </div>
        {docError && <div className="error-box" style={{ margin: '0 18px 12px' }}>{docError}</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Файл</th>
                <th style={{ width: 90 }}>Размер</th>
                <th style={{ width: 150 }}>Загружен</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td style={{ fontWeight: 500 }}>{d.filename}</td>
                  <td className="text-muted">{fmtSize(d.size_bytes)}</td>
                  <td className="text-muted">{new Date(d.created_at).toLocaleString('ru-RU')}</td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => api.documents.download(d.id, d.filename)}>Скачать</button>
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr><td colSpan={4} className="empty-state">Файлов пока нет — прикрепите скан или PDF счёта</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: '10px 18px', borderTop: '1px solid var(--color-divider)' }}>
          <span className="field-hint">Разрешены PDF, JPG, PNG, до 15 МБ. Автоматическое распознавание полей — в следующих обновлениях.</span>
        </div>
      </div>

      <ItemsCard invoiceId={id} items={inv.items ?? []} onChanged={() => load(true)} />

      <div className="section-title">История платежей</div>
      <div className="card blueprint" style={{ position: 'relative', padding: 0 }}>
        <Corners />
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сумма</th>
                <th>Способ</th>
                <th>Референс</th>
                <th style={{ width: 90 }} />
              </tr>
            </thead>
            <tbody>
              {(inv.payments as Payment[] ?? []).map(p => (
                <tr key={p.id}>
                  <td>{new Date(p.payment_date).toLocaleDateString('ru-RU')}</td>
                  <td style={{ fontWeight: 600 }}>{p.amount_display}</td>
                  <td>{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td className="text-muted">{p.reference ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <a className="btn btn-ghost btn-sm" href={`/invoices/${id}/receipt?payment=${p.id}`} target="_blank" rel="noreferrer">Акт</a>
                    <button
                      type="button" className="btn btn-ghost btn-icon" disabled={deletingPaymentId === p.id}
                      title="Удалить платёж (например, если разнесён по ошибке)"
                      onClick={async () => {
                        if (!confirm(`Удалить платёж на ${p.amount_display} от ${new Date(p.payment_date).toLocaleDateString('ru-RU')}? Сумма и статус счёта будут пересчитаны.`)) return;
                        setDeletingPaymentId(p.id);
                        setInv((prev: any) => prev && { ...prev, payments: prev.payments.filter((x: Payment) => x.id !== p.id) });
                        try {
                          await api.payments.delete(p.id);
                          load(true);
                        } catch (e: any) {
                          alert(e.message || 'Не удалось удалить платёж');
                          load(true);
                        } finally {
                          setDeletingPaymentId(null);
                        }
                      }}
                    >
                      <X size={14} strokeWidth={1.5} />
                    </button>
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

type InvoiceItem = {
  id: string; name: string; quantity: string; unit: string | null;
  unit_price_kopecks: number; unit_price_display: string; amount_display: string;
};

function ItemsCard({ invoiceId, items, onChanged }: { invoiceId: string; items: InvoiceItem[]; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const q = Number(quantity.replace(',', '.'));
    const p = Number(price.replace(',', '.'));
    if (!name.trim()) { setError('Укажите название'); return; }
    if (!q || q <= 0) { setError('Укажите количество больше нуля'); return; }
    if (!p || p <= 0) { setError('Укажите цену больше нуля'); return; }

    setSaving(true);
    try {
      await api.invoices.addItem(invoiceId, { name: name.trim(), quantity: q, unit: unit || undefined, unit_price_kopecks: Math.round(p * 100) });
      setName(''); setQuantity('1'); setPrice('');
      setShowForm(false);
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Не удалось добавить позицию');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (itemId: string) => {
    if (!confirm('Удалить позицию?')) return;
    try {
      await api.invoices.deleteItem(invoiceId, itemId);
      onChanged();
    } catch (e: any) {
      alert(e.message || 'Не удалось удалить позицию');
    }
  };

  return (
    <>
      <div className="section-title">Товары/услуги</div>
      <div className="card blueprint" style={{ position: 'relative', marginBottom: 20, padding: 0 }}>
        <Corners />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 18px', borderBottom: '1px solid var(--color-divider)' }}>
          <span />
          <button type="button" className="btn btn-secondary blueprint btn-sm" onClick={() => setShowForm(s => !s)}>
            <Corners />{showForm ? <><X size={13} strokeWidth={1.5} /> Отмена</> : <><Plus size={13} strokeWidth={1.5} /> Добавить позицию</>}
          </button>
        </div>

        {showForm && (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--color-divider)' }}>
            <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <input className="input" style={{ flex: 3, minWidth: 160 }} placeholder="Наименование" value={name} onChange={e => setName(e.target.value)} autoFocus />
              <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Кол-во" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Ед." value={unit} onChange={e => setUnit(e.target.value)} />
              <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Цена, ₽" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Сохраняем…' : 'Добавить'}</button>
            </form>
            {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
          </div>
        )}

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Наименование</th><th style={{ width: 70 }}>Кол-во</th><th style={{ width: 60 }}>Ед.</th><th style={{ width: 100 }}>Цена</th><th style={{ width: 110 }}>Сумма</th><th style={{ width: 44 }} /></tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id}>
                  <td>{it.name}</td>
                  <td>{it.quantity}</td>
                  <td>{it.unit ?? '—'}</td>
                  <td>{it.unit_price_display}</td>
                  <td style={{ fontWeight: 600 }}>{it.amount_display}</td>
                  <td><button type="button" className="btn btn-ghost btn-icon" onClick={() => remove(it.id)}><X size={14} strokeWidth={1.5} /></button></td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className="empty-state">Позиции не добавлены</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
