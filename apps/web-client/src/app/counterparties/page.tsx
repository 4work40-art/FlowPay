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

type RatingItem = {
  counterparty_id: string; name: string; inn: string | null;
  total_kopecks: number; total_display: string; share_pct: number; cumulative_pct: number; group: 'A' | 'B' | 'C';
};

const GROUP_COLOR: Record<string, string> = {
  A: 'var(--green-dark, #1a7a4c)', B: 'var(--amber-dark, #a06a00)', C: 'var(--text2, #888)',
};
const GROUP_BG: Record<string, string> = {
  A: 'var(--green-light, #e8f5ee)', B: 'var(--amber-light, #fdf1dc)', C: 'var(--border-light, #f0f0f0)',
};

export default function CounterpartiesPage() {
  const [mode, setMode] = useState<'list' | 'rating'>('list');
  const [items,   setItems]   = useState<Counterparty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [query,   setQuery]   = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form,    setForm]    = useState(EMPTY_FORM);
  const [saving,  setSaving]  = useState(false);
  const [formError, setFormError] = useState('');
  const [suggesting, setSuggesting] = useState(false);

  const [rating, setRating] = useState<RatingItem[]>([]);
  const [ratingTotal, setRatingTotal] = useState('');
  const [ratingLoading, setRatingLoading] = useState(false);
  const [ratingError, setRatingError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.counterparties.list()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadRating = useCallback(() => {
    setRatingLoading(true);
    setRatingError('');
    api.counterparties.rating()
      .then(res => { setRating(res.data?.items ?? []); setRatingTotal(res.data?.total_display ?? ''); })
      .catch((e: Error) => setRatingError(e.message))
      .finally(() => setRatingLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (mode === 'rating' && !rating.length) loadRating(); }, [mode, loadRating, rating.length]);

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
          <div className="view-toggle">
            <button className={`view-toggle-btn${mode === 'list' ? ' active' : ''}`} onClick={() => setMode('list')}>Список</button>
            <button className={`view-toggle-btn${mode === 'rating' ? ' active' : ''}`} onClick={() => setMode('rating')}>Рейтинг закупок</button>
          </div>
          {mode === 'list' && (
            <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
              {showForm ? '× Отмена' : '+ Добавить контрагента'}
            </button>
          )}
        </div>
      </div>

      {mode === 'rating' ? (
        <>
          <div className="card" style={{ marginBottom: 16, padding: 16, fontSize: 13.5, color: 'var(--text2)' }}>
            ABC-анализ по объёму закупок (правило Парето): <b style={{ color: GROUP_COLOR.A }}>A</b> — поставщики,
            дающие первые 80% суммарного объёма закупок — с ними стоит выстраивать долгосрочные отношения и иметь
            резервный вариант на случай сбоев; <b style={{ color: GROUP_COLOR.B }}>B</b> — следующие 15% (важные, но
            не критичные); <b style={{ color: GROUP_COLOR.C }}>C</b> — оставшиеся 5% (легко заменить). Считается по
            сумме выставленных счетов за всё время, не по факту оплаты.
          </div>
          {ratingLoading ? (
            <div className="loading">⏳ Загрузка...</div>
          ) : ratingError ? (
            <div className="error-box"><strong>Ошибка:</strong> {ratingError}</div>
          ) : (
            <div className="card">
              <div className="card-header">
                <span>Рейтинг поставщиков</span>
                <span style={{ color: 'var(--text2)', fontWeight: 400 }}>Всего закупок: {ratingTotal}</span>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>#</th><th>Название</th><th>ИНН</th><th>Сумма закупок</th><th>Доля</th><th>Группа</th></tr>
                  </thead>
                  <tbody>
                    {rating.map((r, i) => (
                      <tr key={r.counterparty_id}>
                        <td style={{ color: 'var(--text2)' }}>{i + 1}</td>
                        <td style={{ fontWeight: 500 }}>{r.name}</td>
                        <td style={{ color: 'var(--text2)' }}>{r.inn ?? '—'}</td>
                        <td style={{ fontWeight: 600 }}>{r.total_display}</td>
                        <td>{r.share_pct}%</td>
                        <td>
                          <span style={{ background: GROUP_BG[r.group], color: GROUP_COLOR[r.group], padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: 12.5 }}>
                            {r.group}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {!rating.length && <tr><td colSpan={6} className="empty-state">Пока нет закупок с привязкой к контрагенту</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      ) : (
      <>
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
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input type="text" value={form.inn} onChange={e => setForm({ ...form, inn: e.target.value })} />
                    <button
                      type="button" className="btn btn-sm"
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
                      {suggesting ? '…' : '↓ Заполнить'}
                    </button>
                  </div>
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
      </>
      )}
    </div>
  );
}
