'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, X } from 'lucide-react';
import { api } from '@/lib/api';
import type { InvoiceItemInput } from '@/lib/api';

type Counterparty = { id: string; name: string; inn: string | null; type: string };
type ItemRow = { name: string; quantity: string; unit: string; price: string };
const emptyItemRow = (): ItemRow => ({ name: '', quantity: '1', unit: 'шт', price: '' });

const VAT_RATES = [0, 5, 7, 10, 20, 22];

export default function NewOutgoingInvoicePage() {
  const router = useRouter();
  const [counterparties, setCounterparties] = useState<Counterparty[]>([]);
  const [cpId, setCpId] = useState('');
  const [newCpName, setNewCpName] = useState('');
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [basis, setBasis] = useState('');
  const [notes, setNotes] = useState('');
  const [vatMode, setVatMode] = useState<'none' | 'rate'>('none');
  const [vatRate, setVatRate] = useState(20);
  const [itemRows, setItemRows] = useState<ItemRow[]>([emptyItemRow()]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.counterparties.list().then(res => setCounterparties(res.data?.items ?? [])).catch(() => {});
  }, []);

  const validItems = (): InvoiceItemInput[] => itemRows
    .filter(r => r.name.trim() && Number(r.quantity.replace(',', '.')) > 0 && Number(r.price.replace(',', '.')) > 0)
    .map(r => ({
      name: r.name.trim(), quantity: Number(r.quantity.replace(',', '.')), unit: r.unit || undefined,
      unit_price_kopecks: Math.round(Number(r.price.replace(',', '.')) * 100),
    }));

  const amountRub = itemRows.reduce((sum, r) => {
    const q = Number(r.quantity.replace(',', '.')), p = Number(r.price.replace(',', '.'));
    return sum + (Number.isFinite(q) && Number.isFinite(p) ? q * p : 0);
  }, 0);
  const vatRub = vatMode === 'rate' && vatRate > 0 ? amountRub - amountRub / (1 + vatRate / 100) : 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const items = validItems();
    if (!items.length) { setError('Добавьте хотя бы одну позицию'); return; }

    setSaving(true);
    try {
      let counterpartyId = cpId || undefined;
      if (!counterpartyId && newCpName.trim()) {
        const cpRes = await api.counterparties.create({ name: newCpName.trim(), type: 'customer' });
        counterpartyId = cpRes.data.id;
      }
      const res = await api.outgoingInvoices.create({
        counterparty_id: counterpartyId,
        number: number || undefined,
        issue_date: issueDate || undefined,
        due_date: dueDate || undefined,
        basis: basis || undefined,
        notes: notes || undefined,
        vat_mode: vatMode,
        vat_rate: vatMode === 'rate' ? vatRate : undefined,
        items,
      });
      router.replace(`/outgoing-invoices/${res.data.id}`);
    } catch (e: any) {
      setError(e.message || 'Не удалось создать счёт');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Выставить счёт</div>
        <a href="/outgoing-invoices" className="btn btn-secondary btn-sm">← К списку</a>
      </div>

      <div className="card blueprint" style={{ maxWidth: 720 }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-body">
          <form onSubmit={submit}>
            {error && <div className="error-box">{error}</div>}

            <div className="form-grid">
              <div className="form-group full">
                <label className="field-label">Клиент</label>
                <select className="input" value={cpId} onChange={e => { setCpId(e.target.value); if (e.target.value) setNewCpName(''); }}>
                  <option value="">{newCpName ? `+ создать «${newCpName}»` : '— выбрать существующего —'}</option>
                  {counterparties.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                {!cpId && (
                  <input className="input" style={{ marginTop: 6 }} type="text" placeholder="Или введите название нового клиента"
                    value={newCpName} onChange={e => setNewCpName(e.target.value)} />
                )}
              </div>

              <div className="form-group">
                <label className="field-label">Номер счёта</label>
                <input className="input" type="text" placeholder="Автоматически" value={number} onChange={e => setNumber(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Дата счёта</label>
                <input className="input" type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Оплатить до</label>
                <input className="input" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">НДС</label>
                <select className="input" value={vatMode} onChange={e => setVatMode(e.target.value as 'none' | 'rate')}>
                  <option value="none">Без НДС</option>
                  <option value="rate">В том числе НДС по ставке</option>
                </select>
              </div>
              {vatMode === 'rate' && (
                <div className="form-group">
                  <label className="field-label">Ставка НДС</label>
                  <select className="input" value={vatRate} onChange={e => setVatRate(Number(e.target.value))}>
                    {VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                  </select>
                </div>
              )}
              <div className="form-group full">
                <label className="field-label">Основание <span className="text-muted" style={{ fontWeight: 400 }}>(необязательно)</span></label>
                <input className="input" type="text" placeholder="Договор №… от …" value={basis} onChange={e => setBasis(e.target.value)} />
              </div>
              <div className="form-group full">
                <label className="field-label">Примечание <span className="text-muted" style={{ fontWeight: 400 }}>(необязательно)</span></label>
                <textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
            </div>

            <div style={{ marginTop: 18, marginBottom: 8 }}>
              <div className="field-label" style={{ marginBottom: 8 }}>Товары/услуги</div>
              {itemRows.map((row, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input className="input" style={{ flex: 3, minWidth: 160 }} placeholder="Наименование" value={row.name}
                    onChange={e => setItemRows(rows => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))} />
                  <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Кол-во" inputMode="decimal" value={row.quantity}
                    onChange={e => setItemRows(rows => rows.map((r, idx) => idx === i ? { ...r, quantity: e.target.value } : r))} />
                  <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Ед." value={row.unit}
                    onChange={e => setItemRows(rows => rows.map((r, idx) => idx === i ? { ...r, unit: e.target.value } : r))} />
                  <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Цена, ₽" inputMode="decimal" value={row.price}
                    onChange={e => setItemRows(rows => rows.map((r, idx) => idx === i ? { ...r, price: e.target.value } : r))} />
                  <button type="button" className="btn btn-icon btn-secondary" disabled={itemRows.length === 1}
                    onClick={() => setItemRows(rows => rows.filter((_, idx) => idx !== i))} aria-label="Удалить позицию">
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setItemRows(rows => [...rows, emptyItemRow()])}>
                <Plus size={14} strokeWidth={1.5} /> Добавить позицию
              </button>
            </div>

            <div style={{ marginTop: 16, padding: 'var(--space-3)', border: '1px solid var(--color-divider)', fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Итого</span>
                <span style={{ fontWeight: 600 }}>{amountRub.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
              </div>
              {vatMode === 'rate' && (
                <div className="text-muted" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span>в т.ч. НДС {vatRate}%</span>
                  <span>{vatRub.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽</span>
                </div>
              )}
            </div>

            <div className="form-actions" style={{ marginTop: 16 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Создаём…' : 'Создать черновик счёта'}
              </button>
              <a href="/outgoing-invoices" className="btn btn-secondary">Отмена</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
