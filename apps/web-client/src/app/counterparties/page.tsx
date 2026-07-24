'use client';
import { useEffect, useState, useCallback } from 'react';
import { Plus, X, ArrowDownToLine } from 'lucide-react';
import { api } from '@/lib/api';

type Counterparty = {
  id: string; name: string; inn: string | null; kpp: string | null;
  phone: string | null; email: string | null; type: string;
  invoice_count: string; debt_kopecks: string; debt_display: string; is_active: boolean;
};

const TYPE_LABEL: Record<string, string> = { vendor: 'Поставщик', contractor: 'Подрядчик', customer: 'Заказчик' };

const EMPTY_FORM = { name: '', inn: '', kpp: '', phone: '', email: '', address: '', type: 'vendor' };

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

export default function CounterpartiesPage() {
  const [items,   setItems]   = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [query,   setQuery]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [formError, setFormError] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.counterparties.list()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Укажите название'); return; }
    setSaving(true);
    try {
      await api.counterparties.create({ ...form, inn: form.inn || undefined, kpp: form.kpp || undefined, phone: form.phone || undefined, email: form.email || undefined, address: form.address || undefined });
      setForm(EMPTY_FORM);
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const filtered = query
    ? items.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || (c.inn ?? '').includes(query))
    : items;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Контрагенты</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a href="/analytics" className="btn btn-ghost btn-sm">Рейтинг закупок — в Аналитике</a>
          <button className="btn btn-primary blueprint btn-sm" onClick={() => setShowForm(s => !s)}>
            <Corners />
            {showForm ? <><X size={14} strokeWidth={1.5} /> Отмена</> : <><Plus size={14} strokeWidth={1.5} /> Добавить контрагента</>}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card blueprint" style={{ position: 'relative', marginBottom: 18, maxWidth: 640, padding: 20 }}>
          <Corners />
          <form onSubmit={submit}>
            {formError && <div className="error-box" style={{ marginBottom: 14 }}>{formError}</div>}
            <div className="form-grid">
              <div className="form-group full">
                <label className="field-label">Название *</label>
                <input className="input" type="text" required autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="field-label">ИНН</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input className="input" type="text" value={form.inn} onChange={e => setForm({ ...form, inn: e.target.value })} />
                  <button
                    type="button" className="btn btn-secondary blueprint btn-sm" style={{ whiteSpace: 'nowrap' }}
                    title="Подтянуть название, КПП и адрес из ЕГРЮЛ/ЕГРИП по ИНН"
                    disabled={suggesting || !form.inn.trim()}
                    onClick={async () => {
                      setSuggesting(true); setFormError('');
                      try {
                        const res = await api.counterparties.suggest(form.inn.trim());
                        const p = res.data;
                        setForm({
                          ...form,
                          name: p.name || form.name,
                          inn: p.inn || form.inn,
                          kpp: p.kpp || form.kpp,
                          address: p.address || form.address,
                        });
                        if (p.status && p.status !== 'ACTIVE')
                          setFormError('Внимание: по данным ЕГРЮЛ организация не действует (' + p.status + ')');
                      } catch (e: any) {
                        setFormError(e.message || 'Не удалось получить данные по ИНН');
                      } finally {
                        setSuggesting(false);
                      }
                    }}>
                    <Corners /><ArrowDownToLine size={13} strokeWidth={1.5} /> {suggesting ? '…' : 'Заполнить'}
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label className="field-label">КПП</label>
                <input className="input" type="text" value={form.kpp} onChange={e => setForm({ ...form, kpp: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="field-label">Телефон</label>
                <input className="input" type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="field-label">Email</label>
                <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="form-group full">
                <label className="field-label">Тип</label>
                <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                  <option value="vendor">Поставщик</option>
                  <option value="contractor">Подрядчик</option>
                  <option value="customer">Заказчик</option>
                </select>
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary blueprint" disabled={saving}><Corners />{saving ? 'Сохраняем…' : 'Сохранить'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="field" style={{ maxWidth: 300, marginBottom: 14 }}>
        <input
          className="input"
          type="text" placeholder="Поиск по названию или ИНН…"
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Загрузка...</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card blueprint" style={{ position: 'relative', padding: 0 }}>
          <Corners />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th style={{ width: 120 }}>ИНН</th>
                  <th style={{ width: 120 }}>Тип</th>
                  <th style={{ width: 80 }}>Счетов</th>
                  <th style={{ width: 120 }}>Долг</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td className="text-muted">{c.inn ?? '—'}</td>
                    <td>{TYPE_LABEL[c.type] ?? c.type}</td>
                    <td>{c.invoice_count}</td>
                    <td style={{ fontWeight: 600, color: +c.debt_kopecks > 0 ? 'var(--color-accent-700)' : 'var(--color-text)' }}>{c.debt_display}</td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr><td colSpan={5} className="empty-state">{query ? 'Ничего не найдено' : 'Контрагентов пока нет'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
