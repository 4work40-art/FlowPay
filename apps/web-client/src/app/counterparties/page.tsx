'use client';
import { useEffect, useState, useCallback } from 'react';
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
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? '× Отмена' : '+ Добавить контрагента'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
          <div className="card-body">
            <form onSubmit={submit}>
              {formError && <div className="error-box" style={{ marginBottom: 14 }}>{formError}</div>}
              <div className="form-grid">
                <div className="form-group full">
                  <label className="field-label">Название *</label>
                  <input type="text" required autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">ИНН</label>
                  <input type="text" value={form.inn} onChange={e => setForm({ ...form, inn: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">КПП</label>
                  <input type="text" value={form.kpp} onChange={e => setForm({ ...form, kpp: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Телефон</label>
                  <input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Email</label>
                  <input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label className="field-label">Тип</label>
                  <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
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
          type="text" placeholder="Поиск по названию или ИНН…" style={{ maxWidth: 280 }}
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="loading">⏳ Загрузка...</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
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
                    <td style={{ color: 'var(--text2)' }}>{c.inn ?? '—'}</td>
                    <td>{TYPE_LABEL[c.type] ?? c.type}</td>
                    <td>{c.invoice_count}</td>
                    <td style={{ fontWeight: 600, color: +c.debt_kopecks > 0 ? 'var(--amber-dark)' : 'var(--green-dark)' }}>{c.debt_display}</td>
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
