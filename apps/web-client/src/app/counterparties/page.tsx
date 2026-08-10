'use client';
import { Fragment, useEffect, useState, useCallback } from 'react';
import { BarChart3, Plus, X, ArrowDown, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { innError } from '@/lib/inn';

type Counterparty = {
  id: string; name: string; inn: string | null; kpp: string | null;
  phone: string | null; email: string | null; type: string;
  invoice_count: string; debt_kopecks: string; debt_display: string; is_active: boolean;
};

// Прогнозный риск просрочки — отдельная объяснимая эвристика, не тот же
// trust_score, что уже показан на Дашборде/в Аналитике (см. api.counterparties.overdueRisk).
type OverdueRisk = {
  available: boolean; message?: string;
  level?: 'low' | 'medium' | 'high'; level_label?: string;
  sample_size?: number; overdue_count?: number; overdue_share_pct?: number;
  avg_delay_days?: number; trend?: 'improving' | 'worsening' | 'stable' | null;
  explanation?: string;
};

const RISK_CHIP_CLASS: Record<string, string> = { low: 'good', medium: 'warn', high: 'bad' };
const TREND_LABEL: Record<string, string> = { improving: 'улучшается', worsening: 'ухудшается', stable: 'без изменений' };

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
  // Точное совпадение ИНН — блокирует сохранение до решения пользователя
  // (перейти к существующему / всё равно создать нового).
  const [duplicateBlock, setDuplicateBlock] = useState<{ existing: { id: string; name: string; inn: string | null }; message: string } | null>(null);
  // Похожее название при другом ИНН — контрагент уже создан, это просто
  // дружелюбное уведомление после сохранения, не требует решения.
  const [duplicateNotice, setDuplicateNotice] = useState<string>('');
  // Раскрытая карточка контрагента с прогнозом риска просрочки — грузится
  // лениво по клику на строку, чтобы не бить эндпоинт для всего списка сразу.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [riskById, setRiskById] = useState<Record<string, OverdueRisk | 'loading' | 'error'>>({});

  const toggleRisk = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!riskById[id]) {
      setRiskById(prev => ({ ...prev, [id]: 'loading' }));
      api.counterparties.overdueRisk(id)
        .then(res => setRiskById(prev => ({ ...prev, [id]: res.data as OverdueRisk })))
        .catch(() => setRiskById(prev => ({ ...prev, [id]: 'error' })));
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.counterparties.list()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.SyntheticEvent, confirmDuplicate = false) => {
    e.preventDefault();
    setFormError('');
    setDuplicateBlock(null);
    if (!form.name.trim()) { setFormError('Укажите название'); return; }
    // ИНН обязателен для новых контрагентов — проверяем и контрольную
    // сумму (тот же алгоритм, что и на сервере, см. lib/inn.ts).
    const innMsg = innError(form.inn);
    if (innMsg) { setFormError(innMsg); return; }
    setSaving(true);
    try {
      const res = await api.counterparties.create({
        ...form, inn: form.inn.trim(), kpp: form.kpp || undefined, phone: form.phone || undefined,
        email: form.email || undefined, address: form.address || undefined,
        check_duplicates: true, confirm_duplicate: confirmDuplicate,
      });
      if (res.data?.duplicate) {
        // Точное совпадение ИНН — не создаём, ждём решения пользователя.
        setDuplicateBlock({ existing: res.data.existing, message: res.data.message });
        return;
      }
      setForm(EMPTY_FORM);
      setShowForm(false);
      setDuplicateNotice(res.data?.warning ? res.data.warning.message : '');
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
          <button className="btn btn-primary btn-sm" onClick={() => { setShowForm(s => !s); setDuplicateBlock(null); setFormError(''); }}>
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
              {duplicateBlock && (
                <div className="error-box" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <AlertTriangle size={16} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{duplicateBlock.message}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button" className="btn btn-secondary btn-sm"
                      onClick={() => { setQuery(duplicateBlock.existing.inn || duplicateBlock.existing.name); setShowForm(false); setDuplicateBlock(null); }}
                    >
                      Перейти к «{duplicateBlock.existing.name}»
                    </button>
                    <button
                      type="button" className="btn btn-primary btn-sm" disabled={saving}
                      onClick={(e) => submit(e, true)}
                    >
                      Всё равно создать нового
                    </button>
                  </div>
                </div>
              )}
              <div className="form-grid">
                <div className="form-group full">
                  <label className="field-label">Название *</label>
                  <input className="input" type="text" required autoFocus value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">ИНН *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="input" type="text" required inputMode="numeric" maxLength={12}
                      placeholder="10 или 12 цифр"
                      value={form.inn} onChange={e => setForm({ ...form, inn: e.target.value })}
                    />
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

      {duplicateNotice && (
        <div className="card blueprint" style={{ marginBottom: 'var(--space-4)', maxWidth: 640, padding: '10px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <AlertTriangle size={16} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ flex: 1 }}>{duplicateNotice}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDuplicateNotice('')}><X size={14} strokeWidth={1.5} /></button>
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
          <div className="table-wrap responsive-table">
            <table className="table">
              <thead>
                <tr>
                  <th />
                  <th>Название</th>
                  <th>ИНН</th>
                  <th>Тип</th>
                  <th>Счетов</th>
                  <th>Долг</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => {
                  const risk = riskById[c.id];
                  const expanded = expandedId === c.id;
                  return (
                    <Fragment key={c.id}>
                      <tr onClick={() => toggleRisk(c.id)} style={{ cursor: 'pointer' }}>
                        <td style={{ width: 24, color: 'var(--color-text-secondary)' }}>
                          {expanded ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                        </td>
                        <td data-label="Название" style={{ fontWeight: 500 }}>{c.name}</td>
                        <td data-label="ИНН" className="text-muted">{c.inn ?? '—'}</td>
                        <td data-label="Тип">{TYPE_LABEL[c.type] ?? c.type}</td>
                        <td data-label="Счетов">{c.invoice_count}</td>
                        <td data-label="Долг" style={{ fontWeight: 600, color: +c.debt_kopecks > 0 ? 'var(--color-accent-700)' : 'inherit' }}>{c.debt_display}</td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={6} style={{ background: 'var(--color-surface-muted)', padding: '14px 20px' }}>
                            {risk === 'loading' && <div className="text-muted">Считаем прогноз риска просрочки…</div>}
                            {risk === 'error' && <div className="text-muted">Не удалось загрузить прогноз риска</div>}
                            {risk && risk !== 'loading' && risk !== 'error' && !risk.available && (
                              <div className="text-muted">{risk.message}</div>
                            )}
                            {risk && risk !== 'loading' && risk !== 'error' && risk.available && (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                                <span className={`health-chip ${RISK_CHIP_CLASS[risk.level!]}`}><i />{risk.level_label}</span>
                                <span style={{ fontSize: 13 }}>{risk.explanation}</span>
                                {risk.trend && (
                                  <span className="text-muted" style={{ fontSize: 12 }}>
                                    Тренд: {TREND_LABEL[risk.trend]}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!filtered.length && (
                  <tr><td colSpan={6} className="empty-state">{query ? 'Ничего не найдено' : 'Контрагентов пока нет'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
