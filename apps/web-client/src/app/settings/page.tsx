'use client';
import { useEffect, useState } from 'react';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';
import { updateToken, clearSession } from '@/lib/auth';

type Me = { name: string; email: string; role: string; org_name: string; plan: string };
type TeamMember = { id: string; name: string; email: string; role: string; is_active: boolean; last_login_at: string | null };
type Org = { id: string; name: string; inn: string | null; kpp: string | null; plan: string };
type Invite = { id: string; email: string; role: string; expires_at: string; used_at: string | null };

export default function SettingsPage() {
  const [me,   setMe]   = useState<Me | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [org,  setOrg]  = useState<Org | null>(null);
  const [loading, setLoading] = useState(true);

  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwOk,    setPwOk]    = useState('');
  const [saving,  setSaving]  = useState(false);

  const [orgName, setOrgName] = useState('');
  const [orgInn,  setOrgInn]  = useState('');
  const [orgKpp,  setOrgKpp]  = useState('');
  const [orgError, setOrgError] = useState('');
  const [orgOk,    setOrgOk]    = useState('');
  const [orgSaving, setOrgSaving] = useState(false);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState('');

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole,  setInviteRole]  = useState('accountant');
  const [inviteError, setInviteError] = useState('');
  const [inviteOk,    setInviteOk]    = useState('');
  const [inviting,    setInviting]    = useState(false);

  const [delPassword, setDelPassword] = useState('');
  const [delError,    setDelError]    = useState('');
  const [deleting,    setDeleting]    = useState(false);
  const [delConfirmOpen, setDelConfirmOpen] = useState(false);

  const [reminderDays, setReminderDays] = useState('3');
  const [reminderSaving, setReminderSaving] = useState(false);
  const [reminderMsg, setReminderMsg] = useState('');

  const loadInvites = () => {
    if (me?.role !== 'owner') return;
    api.organization.invites.list().then(r => setInvites(r.data?.items ?? [])).catch(() => {});
  };

  useEffect(() => {
    api.organization.fetchLogoBlobUrl().then(setLogoUrl).catch(() => {});
  }, []);

  useEffect(() => {
    api.organization.getReminderSettings()
      .then(r => setReminderDays(String(r.data.reminder_days_before)))
      .catch(() => {});
  }, []);

  const saveReminderSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setReminderMsg('');
    const days = Number(reminderDays);
    if (!Number.isInteger(days) || days < 0 || days > 30) {
      setReminderMsg('Укажите целое число дней от 0 до 30');
      return;
    }
    setReminderSaving(true);
    try {
      await api.organization.updateReminderSettings(days);
      setReminderMsg('Сохранено');
    } catch (e: any) {
      setReminderMsg(e.message || 'Не удалось сохранить');
    } finally {
      setReminderSaving(false);
    }
  };

  const onLogoSelected = async (file: File | null) => {
    if (!file) return;
    setLogoError('');
    setLogoUploading(true);
    try {
      await api.organization.uploadLogo(file);
      const url = await api.organization.fetchLogoBlobUrl();
      setLogoUrl(url);
    } catch (e: any) {
      setLogoError(e.message || 'Не удалось загрузить логотип');
    } finally {
      setLogoUploading(false);
    }
  };

  useEffect(() => {
    Promise.all([api.users.me(), api.users.list(), api.organization.me()])
      .then(([m, t, o]) => {
        setMe(m.data); setTeam(t.data?.items ?? []);
        setOrg(o.data); setOrgName(o.data.name); setOrgInn(o.data.inn ?? ''); setOrgKpp(o.data.kpp ?? '');
        if (m.data.role === 'owner') {
          api.organization.invites.list().then(r => setInvites(r.data?.items ?? [])).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteError(''); setInviteOk('');
    setInviting(true);
    try {
      await api.organization.invites.create({ email: inviteEmail, role: inviteRole });
      setInviteOk('Приглашение отправлено');
      setInviteEmail('');
      loadInvites();
    } catch (e: any) {
      setInviteError(e.message || 'Не удалось отправить приглашение');
    } finally {
      setInviting(false);
    }
  };

  const revokeInvite = async (id: string) => {
    try {
      await api.organization.invites.revoke(id);
      loadInvites();
    } catch (e: any) {
      alert('Не удалось отозвать: ' + e.message);
    }
  };

  const saveOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setOrgError(''); setOrgOk('');
    setOrgSaving(true);
    try {
      const res = await api.organization.update({ name: orgName, inn: orgInn || undefined, kpp: orgKpp || undefined });
      setOrg(res.data);
      setOrgOk('Сохранено');
    } catch (e: any) {
      setOrgError(e.message || 'Не удалось сохранить');
    } finally {
      setOrgSaving(false);
    }
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(''); setPwOk('');
    if (next.length < 8) { setPwError('Новый пароль — минимум 8 символов'); return; }
    if (next !== confirm) { setPwError('Пароли не совпадают'); return; }

    setSaving(true);
    try {
      const res = await api.users.changePassword(current, next);
      // Сервер отзывает все сессии и выдаёт текущей новый токен — сохраняем,
      // иначе следующий же запрос закончится выходом из системы.
      if (res?.data?.access_token) updateToken(res.data.access_token);
      setPwOk('Пароль изменён, остальные сессии завершены');
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
            {me?.role === 'owner' ? (
              <form onSubmit={saveOrg}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  {logoUrl
                    ? <img src={logoUrl} alt="Логотип" style={{ width: 48, height: 48, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 6 }} />
                    : <div style={{ width: 48, height: 48, borderRadius: 6, background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#bbb' }}>🏢</div>}
                  <label className="btn btn-sm" style={{ cursor: 'pointer' }}>
                    {logoUploading ? 'Загружаем…' : 'Загрузить логотип'}
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} disabled={logoUploading}
                      onChange={e => { onLogoSelected(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                </div>
                {logoError && <div className="error-box" style={{ marginBottom: 12 }}>{logoError}</div>}

                {orgError && <div className="error-box" style={{ marginBottom: 12 }}>{orgError}</div>}
                {orgOk && <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 12 }}>{orgOk}</div>}

                <div className="form-group">
                  <label className="field-label">Название</label>
                  <input type="text" required value={orgName} onChange={e => setOrgName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="field-label">ИНН</label>
                  <input type="text" value={orgInn} onChange={e => setOrgInn(e.target.value)} placeholder="10 или 12 цифр" />
                </div>
                <div className="form-group">
                  <label className="field-label">КПП</label>
                  <input type="text" value={orgKpp} onChange={e => setOrgKpp(e.target.value)} placeholder="9 цифр" />
                </div>
                <div style={{ marginBottom: 10 }}>
                  <div className="field-label">Тариф</div>
                  <div style={{ fontWeight: 500 }}>{PLAN_LABEL[org?.plan ?? ''] ?? org?.plan}</div>
                </div>
                <button type="submit" className="btn btn-primary btn-sm" disabled={orgSaving}>
                  {orgSaving ? 'Сохраняем…' : 'Сохранить'}
                </button>
              </form>
            ) : (
              <>
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
              </>
            )}
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
        {me?.role === 'owner' && (
          <div className="card-body" style={{ borderTop: '1px solid var(--border)' }}>
            <form onSubmit={sendInvite} style={{ display: 'flex', gap: 8, marginBottom: invites.length ? 16 : 0, flexWrap: 'wrap' }}>
              {inviteError && <div className="error-box" style={{ flexBasis: '100%' }}>{inviteError}</div>}
              {inviteOk && <div style={{ flexBasis: '100%', background: 'var(--green-light)', color: 'var(--green-dark)', padding: '6px 10px', borderRadius: 6, fontSize: 13 }}>{inviteOk}</div>}
              <input type="email" required placeholder="email коллеги" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="accountant">Бухгалтер</option>
                <option value="readonly">Только чтение</option>
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}>
                {inviting ? 'Отправляем…' : '+ Пригласить'}
              </button>
            </form>

            {invites.filter(i => !i.used_at).length > 0 && (
              <table style={{ width: '100%', fontSize: 13 }}>
                <tbody>
                  {invites.filter(i => !i.used_at).map(inv => (
                    <tr key={inv.id}>
                      <td style={{ padding: '4px 0' }}>{inv.email}</td>
                      <td style={{ color: 'var(--text2)' }}>{ROLE_LABEL[inv.role] ?? inv.role}</td>
                      <td style={{ color: 'var(--text2)', fontSize: 12 }}>
                        до {new Date(inv.expires_at).toLocaleDateString('ru-RU')}
                      </td>
                      <td>
                        <button className="btn btn-sm" onClick={() => revokeInvite(inv.id)}>Отозвать</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">Напоминания об оплате</div>
        <div className="card-body">
          <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 12 }}>
            За сколько дней до срока оплаты присылать email-напоминание о счетах, которые скоро нужно оплатить.
          </p>
          <form onSubmit={saveReminderSettings} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="number" min={0} max={30} style={{ maxWidth: 100 }} disabled={me?.role !== 'owner'}
              value={reminderDays} onChange={e => setReminderDays(e.target.value)} />
            <span>дней до срока</span>
            {me?.role === 'owner' && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={reminderSaving}>
                {reminderSaving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            )}
            {reminderMsg && <span style={{ fontSize: 13, color: 'var(--text2)' }}>{reminderMsg}</span>}
          </form>
        </div>
      </div>

      {me?.role === 'owner' && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--red, #c0392b)' }}>
          <div className="card-header" style={{ color: 'var(--red, #c0392b)' }}>Удаление организации</div>
          <div className="card-body">
            <p style={{ fontSize: 13.5, color: 'var(--text2)', marginBottom: 12 }}>
              Организация, все её счета, платежи, контрагенты, документы и учётные записи
              сотрудников будут удалены безвозвратно (152-ФЗ: отзыв согласия на обработку
              персональных данных). Отменить это действие невозможно.
            </p>
            {!delConfirmOpen ? (
              <button className="btn btn-sm" style={{ color: 'var(--red, #c0392b)' }} onClick={() => setDelConfirmOpen(true)}>
                Удалить организацию…
              </button>
            ) : (
              <form onSubmit={async (e) => {
                e.preventDefault();
                setDelError('');
                setDeleting(true);
                try {
                  await api.organization.deleteMe(delPassword);
                  clearSession();
                  window.location.href = '/';
                } catch (err: any) {
                  setDelError(err.message || 'Не удалось удалить организацию');
                  setDeleting(false);
                }
              }}>
                {delError && <div className="error-box" style={{ marginBottom: 12 }}>{delError}</div>}
                <div className="form-group" style={{ maxWidth: 320 }}>
                  <label className="field-label">Введите пароль для подтверждения</label>
                  <input type="password" required value={delPassword} onChange={e => setDelPassword(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-sm" style={{ color: '#fff', background: 'var(--red, #c0392b)' }} disabled={deleting}>
                    {deleting ? 'Удаляем…' : 'Удалить навсегда'}
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => { setDelConfirmOpen(false); setDelPassword(''); setDelError(''); }}>
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
