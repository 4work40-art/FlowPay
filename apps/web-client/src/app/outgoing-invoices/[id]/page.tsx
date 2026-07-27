'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Plus, X, Trash2, FileDown, FileSpreadsheet, Send, CheckCircle2, Ban, RotateCcw } from 'lucide-react';
import { api, OUTGOING_STATUS_LABEL, OUTGOING_STATUS_DESCRIPTION } from '@/lib/api';
import type { InvoiceItemInput } from '@/lib/api';

type Item = {
  id: string; name: string; quantity: string; unit: string | null;
  unit_price_display: string; amount_display: string;
};

const TRANSITIONS: Record<string, { label: string; from: string[]; cls: string; icon: any }> = {
  send:         { label: 'Отправить клиенту', from: ['draft'],           cls: 'btn-primary',   icon: Send },
  mark_paid:    { label: 'Отметить оплаченным', from: ['sent', 'overdue'], cls: 'btn-primary',   icon: CheckCircle2 },
  mark_overdue: { label: 'Отметить просроченным', from: ['sent'],         cls: 'btn-secondary', icon: Ban },
  cancel:       { label: 'Отменить счёт',       from: ['draft', 'sent', 'overdue'], cls: 'btn-secondary', icon: Ban },
  reopen:       { label: 'Вернуть в черновики', from: ['cancelled'],      cls: 'btn-secondary', icon: RotateCcw },
};

export default function OutgoingInvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    api.outgoingInvoices.get(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const doTransition = async (transition: string) => {
    setActing(true);
    try {
      await api.outgoingInvoices.transition(id, transition as any);
      load(true);
    } catch (e: any) {
      alert(e.message || 'Не удалось изменить статус');
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;
  if (error) {
    return (
      <div className="error-box">
        <strong>Ошибка:</strong> {error}
        <br />
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => load()}>Повторить</button>
      </div>
    );
  }
  if (!inv) return null;

  const available = Object.entries(TRANSITIONS).filter(([, t]) => t.from.includes(inv.status));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Счёт № {inv.number}</div>
          <div className="page-sub">от {new Date(inv.issue_date).toLocaleDateString('ru-RU')} · {inv.counterparty_name || 'без клиента'}</div>
        </div>
        <a href="/outgoing-invoices" className="btn btn-secondary btn-sm">← К списку</a>
      </div>

      <div className="grid-2" style={{ marginBottom: 'var(--space-4)', alignItems: 'start' }}>
        <div className="metric-grid" style={{ marginBottom: 0 }}>
          <div className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">Сумма</div>
            <div className="metric-value">{inv.amount_display}</div>
          </div>
          <div className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">НДС</div>
            <div className="metric-value">{inv.vat_mode === 'rate' ? inv.vat_display : 'Без НДС'}</div>
          </div>
          <div className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">Статус</div>
            <div className="metric-value" style={{ fontSize: 16 }} title={OUTGOING_STATUS_DESCRIPTION[inv.status] ?? ''}>
              {OUTGOING_STATUS_LABEL[inv.status] ?? inv.status}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a className="btn btn-secondary btn-sm" href={`/outgoing-invoices/${id}/print`} target="_blank" rel="noreferrer">
              <FileDown size={14} strokeWidth={1.5} /> Скачать PDF
            </a>
            <button className="btn btn-secondary btn-sm" onClick={() => api.outgoingInvoices.downloadExcel(id, inv.number).catch((e: Error) => alert(e.message))}>
              <FileSpreadsheet size={14} strokeWidth={1.5} /> Скачать Excel
            </button>
          </div>
          {available.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {available.map(([key, t]) => {
                const Icon = t.icon;
                return (
                  <button key={key} className={`btn ${t.cls} btn-sm`} disabled={acting} onClick={() => doTransition(key)}>
                    <Icon size={14} strokeWidth={1.5} /> {t.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Реквизиты</div>
        <div className="card-body">
          <div className="grid-2">
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>Продавец</div>
              <div style={{ fontSize: 13.5 }}>{inv.org_name}{inv.org_inn ? `, ИНН ${inv.org_inn}` : ''}{inv.org_kpp ? `, КПП ${inv.org_kpp}` : ''}</div>
              {inv.org_bank_account && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {inv.org_bank_name}, БИК {inv.org_bank_bik}, р/с {inv.org_bank_account}
                </div>
              )}
            </div>
            <div>
              <div className="field-label" style={{ marginBottom: 4 }}>Покупатель</div>
              <div style={{ fontSize: 13.5 }}>{inv.counterparty_name || '—'}{inv.counterparty_inn ? `, ИНН ${inv.counterparty_inn}` : ''}</div>
              {inv.basis && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>Основание: {inv.basis}</div>}
            </div>
          </div>
          {!inv.org_bank_account && (
            <div className="error-box" style={{ marginTop: 12 }}>
              Реквизиты продавца не заполнены — печатная форма будет неполной. <a href="/settings">Заполнить в настройках →</a>
            </div>
          )}
        </div>
      </div>

      <ItemsCard invoiceId={id} items={inv.items ?? []} editable={inv.status === 'draft'} onChanged={() => load(true)} />
    </div>
  );
}

function ItemsCard({ invoiceId, items, editable, onChanged }: { invoiceId: string; items: Item[]; editable: boolean; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const q = Number(quantity.replace(',', '.'));
    const p = Number(price.replace(',', '.'));
    if (!name.trim()) { setError('Укажите наименование'); return; }
    if (!q || q <= 0) { setError('Некорректное количество'); return; }
    if (!p || p <= 0) { setError('Некорректная цена'); return; }

    setSaving(true);
    try {
      const item: InvoiceItemInput = { name: name.trim(), quantity: q, unit: unit || undefined, unit_price_kopecks: Math.round(p * 100) };
      await api.outgoingInvoices.addItem(invoiceId, item);
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
      await api.outgoingInvoices.deleteItem(invoiceId, itemId);
      onChanged();
    } catch (e: any) {
      alert(e.message || 'Не удалось удалить позицию');
    }
  };

  return (
    <div className="card blueprint">
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      <div className="card-header">
        <span>Товары/услуги</span>
        {editable && (
          <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(s => !s)}>
            {showForm ? <><X size={14} strokeWidth={1.5} /> Отмена</> : <><Plus size={14} strokeWidth={1.5} /> Добавить позицию</>}
          </button>
        )}
      </div>

      {showForm && editable && (
        <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
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

      <div className="table-wrap responsive-table">
        <table className="table">
          <thead>
            <tr><th scope="col">Наименование</th><th scope="col">Кол-во</th><th scope="col">Ед.</th><th scope="col">Цена</th><th scope="col">Сумма</th>{editable && <th scope="col"></th>}</tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id}>
                <td data-label="Наименование">{it.name}</td>
                <td data-label="Кол-во">{it.quantity}</td>
                <td data-label="Ед.">{it.unit ?? '—'}</td>
                <td data-label="Цена">{it.unit_price_display}</td>
                <td data-label="Сумма" style={{ fontWeight: 600 }}>{it.amount_display}</td>
                {editable && (
                  <td><button className="btn btn-icon btn-secondary" onClick={() => remove(it.id)} aria-label={`Удалить позицию «${it.name}»`}><Trash2 size={14} strokeWidth={1.5} /></button></td>
                )}
              </tr>
            ))}
            {!items.length && <tr><td colSpan={editable ? 6 : 5} className="empty-state">Позиции не добавлены</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
