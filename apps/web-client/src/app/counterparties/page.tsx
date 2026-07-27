'use client';
import { useEffect, useState, useCallback } from 'react';
import { BarChart3, Plus, X, ArrowDown } from 'lucide-react';
import { api } from '@/lib/api';

type Counterparty = {
  id: string; name: string; inn: string | null; kpp: string | null;
  phone: string | null; email: string | null; type: string;
  invoice_count: string; debt_kopecks: string; debt_display: string; is_active: boolean;
};

const TYPE_LABEL: Record<string, string> = { vendor: 'Поставщик', contractor: 'Подрядчик', customer: 'Заказчик' };

const EMPTY_FORM = { name: '', inn: '', kpp: '', phone: '', email: '', address: '', type: 'vendor' };

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
        <div className="page-title">Контрагенты</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a href="/analytics" className="btn btn-secondary btn-sm"><BarChart3 size={14} strokeWidth={1.5} /> Рейтинг закупок — в Аналитике</a>
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
            {showForm ? <><X size={14} strokeWidth={1.5} /> Отмена</> : <><Plus size={14} strokeWidth={1.5} /> Добавить контрагента</>}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="card blueprint" style={{ marginBottom: 'var(--space-4)', maxWidth: 640 }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-body">
            <form onSubmit={submit}>
              {formError && <div className="error-box">{formError}</div>}
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
                      type="button" className="btn btn-secondary btn-sm"
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
                      {suggesting ? '…' : <><ArrowDown size={14} strokeWidth={1.5} /> Заполнить</>}
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
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="filter-row">
        <input
          className="input" type="text" placeholder="Поиск по названию или ИНН…" style={{ maxWidth: 280 }}
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">Загрузка…</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Название</th>
                  <th>ИНН</th>
                  <th>Тип</th>
                  <th>Счетов</th>
                  <th>Долг</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 500 }}>{c.name}</td>
                    <td className="text-muted">{c.inn ?? '—'}</td>
                    <td>{TYPE_LABEL[c.type] ?? c.type}</td>
                    <td>{c.invoice_count}</td>
                    <td style={{ fontWeight: 600, color: +c.debt_kopecks > 0 ? 'var(--color-accent-700)' : 'inherit' }}>{c.debt_display}</td>
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
