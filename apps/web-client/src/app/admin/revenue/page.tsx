'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, PLAN_LABEL } from '@/lib/api';
import AdminTabs from '@/components/AdminTabs';

type RevenueEvent = {
  id: string; org_name: string; plan: string | null; amount_display: string;
  occurred_at: string; note: string | null; source: 'manual' | 'yookassa';
};
type Org = { id: string; name: string };

export default function AdminRevenuePage() {
  const [items,   setItems]   = useState<RevenueEvent[]>([]);
  const [total,   setTotal]   = useState('0 ₽');
  const [orgs,    setOrgs]    = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [showForm, setShowForm] = useState(false);

  const [orgId,   setOrgId]   = useState('');
  const [amount,  setAmount]  = useState('');
  const [plan,    setPlan]    = useState('');
  const [date,    setDate]    = useState(() => new Date().toISOString().slice(0, 10));
  const [note,    setNote]    = useState('');
  const [saving,  setSaving]  = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([api.admin.revenueEvents(), api.admin.organizations()])
      .then(([rev, orgsRes]) => {
        setItems(rev.data?.items ?? []);
        setTotal(rev.data?.total_gross?.display ?? '0 ₽');
        setOrgs(orgsRes.data?.items ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    const rub = Number(amount.replace(',', '.'));
    if (!orgId) { setFormError('Выберите организацию'); return; }
    if (!rub || rub <= 0) { setFormError('Укажите сумму больше нуля'); return; }

    setSaving(true);
    try {
      await api.admin.createRevenueEvent({
        org_id: orgId, amount_kopecks: Math.round(rub * 100),
        plan: plan || undefined, occurred_at: date, note: note || undefined,
      });
      setOrgId(''); setAmount(''); setPlan(''); setNote('');
      setShowForm(false);
      load();
    } catch (e: any) {
      setFormError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Доход</div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? '× Отмена' : '+ Добавить платёж'}
        </button>
      </div>

      <AdminTabs />

      {showForm && (
        <div className="card" style={{ marginBottom: 16, maxWidth: 560 }}>
          <div className="card-body">
            <form onSubmit={submit}>
              {formError && <div className="error-box" style={{ marginBottom: 14 }}>{formError}</div>}
              <div className="form-grid">
                <div className="form-group full">
                  <label className="field-label">Организация *</label>
                  <select value={orgId} onChange={e => setOrgId(e.target.value)} required>
                    <option value="">— выберите —</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="field-label">Сумма, ₽ *</label>
                  <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="field-label">Тариф</label>
                  <select value={plan} onChange={e => setPlan(e.target.value)}>
                    <option value="">— не указан —</option>
                    {Object.entries(PLAN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="field-label">Дата</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} />
                </div>
                <div className="form-group full">
                  <label className="field-label">Примечание</label>
                  <input type="text" placeholder="Например: оплата за квартал по счёту №12" value={note} onChange={e => setNote(e.target.value)} />
                </div>
              </div>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</button>
            </form>
          </div>
        </div>
      )}

      {!items.length ? (
        <div className="card">
          <div className="card-body" style={{ textAlign: 'center', padding: '40px 20px' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🔒</div>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Учёт дохода ещё не начат</div>
            <div style={{ color: 'var(--text2)', fontSize: 13.5, maxWidth: 420, margin: '0 auto 16px' }}>
              Здесь будет валовый доход и LTV, когда появятся первые платежи за подписку. Показывать эти цифры до появления реальных данных мы не стали — это были бы выдуманные значения. Нажмите «Добавить платёж», как только кто-то заплатит вам за тариф.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="metric-grid" style={{ marginBottom: 16 }}>
            <div className="metric-card green">
              <div className="metric-label">Валовый доход (ЮKassa + вручную)</div>
              <div className="metric-value">{total}</div>
            </div>
          </div>
          <div className="card">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Дата</th><th>Организация</th><th>Тариф</th><th>Сумма</th><th>Источник</th><th>Примечание</th></tr>
                </thead>
                <tbody>
                  {items.map(r => (
                    <tr key={r.id}>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>{new Date(r.occurred_at).toLocaleDateString('ru-RU')}</td>
                      <td style={{ fontWeight: 500 }}>{r.org_name}</td>
                      <td>{r.plan ? (PLAN_LABEL[r.plan] ?? r.plan) : '—'}</td>
                      <td style={{ fontWeight: 600 }}>{r.amount_display}</td>
                      <td>{r.source === 'yookassa' ? 'ЮKassa (авто)' : 'Вручную'}</td>
                      <td style={{ color: 'var(--text2)' }}>{r.note ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
