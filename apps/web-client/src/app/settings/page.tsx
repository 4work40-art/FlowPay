'use client';
import { useEffect, useState } from 'react';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';

type Me = { name: string; email: string; role: string; org_name: string; plan: string; trust_score: number };
type TeamMember = { id: string; name: string; email: string; role: string; is_active: boolean; last_login_at: string | null };

export default function SettingsPage() {
  const [me,   setMe]   = useState<Me | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwOk,    setPwOk]    = useState('');
  const [saving,  setSaving]  = useState(false);

  useEffect(() => {
    Promise.all([api.users.me(), api.users.list()])
      .then(([m, t]) => { setMe(m.data); setTeam(t.data?.items ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(''); setPwOk('');
    if (next.length < 8) { setPwError('Новый пароль — минимум 8 символов'); return; }
    if (next !== confirm) { setPwError('Пароли не совпадают'); return; }

    setSaving(true);
    try {
      await api.users.changePassword(current, next);
      setPwOk('Пароль изменён');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e: any) {
      setPwError(e.message || 'Не удалось сменить пароль');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">⏳ Загрузка...</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Настройки</div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-header">Организация</div>
          <div className="card-body">
            <div style={{ marginBottom: 10 }}>
              <div className="field-label">Название</div>
              <div style={{ fontWeight: 500 }}>{me?.org_name}</div>
            </div>
            <div style={{ marginBottom: 10 }}>
              <div className="field-label">Тариф</div>
              <div style={{ fontWeight: 500 }}>{PLAN_LABEL[me?.plan ?? ''] ?? me?.plan}</div>
            </div>
            <div>
              <div className="field-label">Ваша роль</div>
              <div style={{ fontWeight: 500 }}>{ROLE_LABEL[me?.role ?? ''] ?? me?.role}</div>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Сменить пароль</div>
          <div className="card-body">
            <form onSubmit={changePassword}>
              {pwError && <div className="error-box" style={{ marginBottom: 12 }}>{pwError}</div>}
              {pwOk && <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{pwOk}</div>}

              <div className="form-group">
                <label className="field-label">Текущий пароль</label>
                <input type="password" required value={current} onChange={e => setCurrent(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Новый пароль</label>
                <input type="password" required value={next} onChange={e => setNext(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Повторите новый пароль</label>
                <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сменить пароль'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Команда · {team.length} чел.</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Имя</th>
                <th>Email</th>
                <th>Роль</th>
                <th>Последний вход</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {team.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.name}</td>
                  <td style={{ color: 'var(--text2)' }}>{u.email}</td>
                  <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('ru-RU') : '—'}</td>
                  <td>
                    <span className={`status-badge ${u.is_active ? 'status-PAID' : 'status-CREATED'}`}>
                      {u.is_active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
          <span className="field-hint">Приглашение новых участников появится в одном из следующих обновлений.</span>
        </div>
      </div>
    </div>
  );
}
