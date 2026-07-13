'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { api, PLAN_LABEL, ROLE_LABEL } from '@/lib/api';

type OrgDetail = {
  id: string; name: string; plan: string; invoice_limit: number; is_active: boolean;
  created_at: string; invoice_count: number;
  users: { id: string; email: string; name: string; role: string; is_active: boolean; last_login_at: string | null }[];
  recent_activity: { id: number; timestamp: string; action: string; resource: string; status: string }[];
};

export default function AdminOrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [org,     setOrg]     = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  const [plan,    setPlan]    = useState('');
  const [limit,   setLimit]   = useState('');
  const [active,  setActive]  = useState(true);
  const [reason,  setReason]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveOk,   setSaveOk]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    api.admin.organization(id)
      .then(res => {
        setOrg(res.data);
        setPlan(res.data.plan);
        setLimit(String(res.data.invoice_limit));
        setActive(res.data.is_active);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!org) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(''); setSaveOk('');
    if (!reason.trim()) { setSaveError('Укажите причину изменения'); return; }

    setSaving(true);
    try {
      await api.admin.updateOrganization(id, {
        plan, invoice_limit: Number(limit), is_active: active, reason,
      });
      setSaveOk('Сохранено');
      setReason('');
      load();
    } catch (e: any) {
      setSaveError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{org.name}</div>
          <div className="page-sub">{org.invoice_count} счетов · зарегистрирована {new Date(org.created_at).toLocaleDateString('ru-RU')}</div>
        </div>
        <a href="/admin/organizations" className="btn btn-sm">← Все организации</a>
      </div>

      <div className="grid-2" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">Тариф и лимиты</div>
          <div className="card-body">
            <form onSubmit={save}>
              {saveError && <div className="error-box" style={{ marginBottom: 12 }}>{saveError}</div>}
              {saveOk && <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{saveOk}</div>}

              <div className="form-group">
                <label className="field-label">Тариф</label>
                <select value={plan} onChange={e => setPlan(e.target.value)}>
                  {Object.entries(PLAN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="field-label">Лимит счетов</label>
                <input type="number" min={0} value={limit} onChange={e => setLimit(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">
                  <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} style={{ width: 'auto', marginRight: 6 }} />
                  Организация активна
                </label>
              </div>
              <div className="form-group">
                <label className="field-label">Причина изменения *</label>
                <input type="text" placeholder="Например: договорились на скидку" value={reason} onChange={e => setReason(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Пользователи · {org.users.length}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Имя</th><th>Роль</th><th>Вход</th></tr>
              </thead>
              <tbody>
                {org.users.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>{u.name}<div style={{ color: 'var(--text2)', fontSize: 11 }}>{u.email}</div></td>
                    <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td style={{ color: 'var(--text2)', fontSize: 12 }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString('ru-RU') : '—'}</td>
                  </tr>
                ))}
                {!org.users.length && <tr><td colSpan={3} className="empty-state">Нет пользователей</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Активность организации</div>
        <div>
          {org.recent_activity.map(e => (
            <div key={e.id} className="audit-item">
              <div className={`audit-dot ${e.status === 'success' ? 'success' : 'error'}`} />
              <span className="audit-action">{e.action}</span>
              <span className="audit-detail">{e.resource}</span>
              <span className="audit-time">{new Date(e.timestamp).toLocaleString('ru-RU')}</span>
            </div>
          ))}
          {!org.recent_activity.length && <div className="empty-state">Событий пока нет</div>}
        </div>
      </div>
    </div>
  );
}
