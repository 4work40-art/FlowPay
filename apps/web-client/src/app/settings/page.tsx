'use client';
import { useEffect, useState } from 'react';
import { Building2, Plus } from 'lucide-react';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';
import { updateToken, clearSession } from '@/lib/auth';
import { isValidInn } from '@/lib/inn';

// Формат-проверки реквизитов организации: поля необязательны, поэтому
// пустое значение всегда допустимо — проверяем только когда что-то введено.
// ИНН — контрольная сумма (тот же алгоритм ФНС, что и на бэкенде и в
// карточке контрагента, см. lib/inn.ts). Остальные — формат, зеркалит
// services/api-gateway/src/lib/inn.js и bankRequisites.js.
function orgInnError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{10}$|^\d{12}$/.test(v))
    return 'ИНН должен состоять из 10 цифр (юрлицо) или 12 цифр (ИП)';
  if (!isValidInn(v))
    return 'ИНН указан некорректно — не совпадает контрольная сумма, проверьте цифры';
  return null;
}
function orgKppError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{4}[\dA-ZА-Я]{2}\d{3}$/.test(v))
    return 'КПП некорректен: ожидается 9 знаков в формате ФНС';
  return null;
}
function bikError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^04\d{7}$/.test(v))
    return 'БИК некорректен: ожидается 9 цифр, начинается с 04';
  return null;
}
function accountError(value: string, label: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (!/^\d{20}$/.test(v))
    return `${label} некорректен: ожидается 20 цифр`;
  return null;
}

type Me = { name: string; email: string; role: string; org_name: string; plan: string };
type TeamMember = { id: string; name: string; email: string; role: string; is_active: boolean; last_login_at: string | null };
type Org = {
  id: string; name: string; inn: string | null; kpp: string | null; plan: string;
  address: string | null; bank_account: string | null; bank_name: string | null;
  bank_bik: string | null; bank_corr_account: string | null;
  director_name: string | null; accountant_name: string | null;
};
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

  // Реквизиты для формы "Счёт на оплату" (см. /outgoing-invoices) — продавец
  // в этой форме сама организация, поэтому банковские реквизиты и подписанты
  // нужны отдельно от общих ИНН/КПП выше.
  const [billingAddress, setBillingAddress] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankBik, setBankBik] = useState('');
  const [bankCorrAccount, setBankCorrAccount] = useState('');
  const [directorName, setDirectorName] = useState('');
  const [accountantName, setAccountantName] = useState('');
  const [billingError, setBillingError] = useState('');
  const [billingOk, setBillingOk] = useState('');
  const [billingSaving, setBillingSaving] = useState(false);
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
        setBillingAddress(o.data.address ?? ''); setBankAccount(o.data.bank_account ?? '');
        setBankName(o.data.bank_name ?? ''); setBankBik(o.data.bank_bik ?? '');
        setBankCorrAccount(o.data.bank_corr_account ?? '');
        setDirectorName(o.data.director_name ?? ''); setAccountantName(o.data.accountant_name ?? '');
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
    const innMsg = orgInnError(orgInn);
    if (innMsg) { setOrgError(innMsg); return; }
    const kppMsg = orgKppError(orgKpp);
    if (kppMsg) { setOrgError(kppMsg); return; }
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

  const saveBilling = async (e: React.FormEvent) => {
    e.preventDefault();
    setBillingError(''); setBillingOk('');
    const bikMsg = bikError(bankBik);
    if (bikMsg) { setBillingError(bikMsg); return; }
    const accountMsg = accountError(bankAccount, 'Расчётный счёт') || accountError(bankCorrAccount, 'Корреспондентский счёт');
    if (accountMsg) { setBillingError(accountMsg); return; }
    setBillingSaving(true);
    try {
      const res = await api.organization.update({
        address: billingAddress, bank_account: bankAccount, bank_name: bankName,
        bank_bik: bankBik, bank_corr_account: bankCorrAccount,
        director_name: directorName, accountant_name: accountantName,
      });
      setOrg(res.data);
      setBillingOk('Сохранено');
    } catch (e: any) {
      setBillingError(e.message || 'Не удалось сохранить');
    } finally {
      setBillingSaving(false);
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

  if (loading) return <div className="loading">Загрузка…</div>;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Настройки</div>
      </div>

      <div className="grid-2" style={{ marginBottom: 'var(--space-4)', alignItems: 'start' }}>
        <div className="card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-header">Организация</div>
          <div className="card-body">
            {me?.role === 'owner' ? (
              <form onSubmit={saveOrg}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  {logoUrl
                    ? <img src={logoUrl} alt="Логотип" style={{ width: 48, height: 48, objectFit: 'contain', border: '1px solid var(--color-divider)' }} />
                    : <div style={{ width: 48, height: 48, border: '1px solid var(--color-divider)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Building2 size={20} strokeWidth={1.5} className="text-muted" /></div>}
                  <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
                    {logoUploading ? 'Загружаем…' : 'Загрузить логотип'}
                    <input type="file" accept="image/png,image/jpeg,image/svg+xml" style={{ display: 'none' }} disabled={logoUploading}
                      onChange={e => { onLogoSelected(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                  </label>
                </div>
                {logoError && <div className="error-box">{logoError}</div>}

                {orgError && <div className="error-box">{orgError}</div>}
                {orgOk && <div className="tag tag-outline" style={{ marginBottom: 12 }}>{orgOk}</div>}

                <div className="form-group">
                  <label className="field-label">Название</label>
                  <input className="input" type="text" required value={orgName} onChange={e => setOrgName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="field-label">ИНН</label>
                  <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={12}
                    value={orgInn} onChange={e => setOrgInn(e.target.value.replace(/\D/g, ''))} placeholder="10 или 12 цифр" />
                </div>
                <div className="form-group">
                  <label className="field-label">КПП</label>
                  <input className="input" type="text" inputMode="numeric" maxLength={9}
                    value={orgKpp} onChange={e => setOrgKpp(e.target.value)} placeholder="9 цифр" />
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

        <div className="card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-header">Сменить пароль</div>
          <div className="card-body">
            <form onSubmit={changePassword}>
              {pwError && <div className="error-box">{pwError}</div>}
              {pwOk && <div className="tag tag-outline" style={{ marginBottom: 12 }}>{pwOk}</div>}

              <div className="form-group">
                <label className="field-label">Текущий пароль</label>
                <input className="input" type="password" required value={current} onChange={e => setCurrent(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Новый пароль</label>
                <input className="input" type="password" required value={next} onChange={e => setNext(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="field-label">Повторите новый пароль</label>
                <input className="input" type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сменить пароль'}
              </button>
            </form>
          </div>
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Реквизиты для выставления счетов</div>
        <div className="card-body">
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 14 }}>
            Эти данные подставляются как реквизиты продавца в форму «Счёт на оплату» при выставлении счетов клиентам —
            заполните их один раз в разделе «Выставленные счета».
          </p>
          {me?.role === 'owner' ? (
            <form onSubmit={saveBilling}>
              {billingError && <div className="error-box">{billingError}</div>}
              {billingOk && <div className="tag tag-outline" style={{ marginBottom: 12 }}>{billingOk}</div>}
              <div className="form-grid">
                <div className="form-group full">
                  <label className="field-label">Юридический адрес</label>
                  <input className="input" type="text" value={billingAddress} onChange={e => setBillingAddress(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="field-label">Расчётный счёт</label>
                  <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={20}
                    value={bankAccount} onChange={e => setBankAccount(e.target.value.replace(/\D/g, ''))} placeholder="20 цифр" />
                </div>
                <div className="form-group">
                  <label className="field-label">Наименование банка</label>
                  <input className="input" type="text" value={bankName} onChange={e => setBankName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="field-label">БИК</label>
                  <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={9}
                    value={bankBik} onChange={e => setBankBik(e.target.value.replace(/\D/g, ''))} placeholder="9 цифр" />
                </div>
                <div className="form-group">
                  <label className="field-label">Корр. счёт</label>
                  <input className="input" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={20}
                    value={bankCorrAccount} onChange={e => setBankCorrAccount(e.target.value.replace(/\D/g, ''))} placeholder="20 цифр" />
                </div>
                <div className="form-group">
                  <label className="field-label">Руководитель</label>
                  <input className="input" type="text" value={directorName} onChange={e => setDirectorName(e.target.value)} placeholder="Иванов И.И." />
                </div>
                <div className="form-group">
                  <label className="field-label">Главный бухгалтер</label>
                  <input className="input" type="text" value={accountantName} onChange={e => setAccountantName(e.target.value)} placeholder="Необязательно" />
                </div>
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={billingSaving}>
                {billingSaving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            </form>
          ) : (
            <div className="text-muted" style={{ fontSize: 13 }}>Изменять реквизиты может только владелец организации.</div>
          )}
        </div>
      </div>

      <div className="card blueprint">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Команда · {team.length} чел.</div>
        <div className="table-wrap responsive-table">
          <table className="table">
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
                  <td data-label="Имя" style={{ fontWeight: 500 }}>{u.name}</td>
                  <td data-label="Email" className="text-muted">{u.email}</td>
                  <td data-label="Роль">{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td data-label="Последний вход" className="text-muted" style={{ fontSize: 12 }}>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('ru-RU') : '—'}</td>
                  <td data-label="Статус">
                    <span className={`tag ${u.is_active ? 'tag-outline' : 'tag-neutral'}`}>
                      {u.is_active ? 'Активен' : 'Отключён'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {me?.role === 'owner' && (
          <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
            <form onSubmit={sendInvite} style={{ display: 'flex', gap: 8, marginBottom: invites.length ? 16 : 0, flexWrap: 'wrap' }}>
              {inviteError && <div className="error-box" style={{ flexBasis: '100%' }}>{inviteError}</div>}
              {inviteOk && <div className="tag tag-outline" style={{ flexBasis: '100%' }}>{inviteOk}</div>}
              <input className="input" type="email" required placeholder="email коллеги" value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <select className="input" style={{ width: 'auto' }} value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="accountant">Бухгалтер</option>
                <option value="readonly">Только чтение</option>
              </select>
              <button type="submit" className="btn btn-primary btn-sm" disabled={inviting}>
                {inviting ? 'Отправляем…' : <><Plus size={14} strokeWidth={1.5} /> Пригласить</>}
              </button>
            </form>

            {invites.filter(i => !i.used_at).length > 0 && (
              <div className="table-wrap responsive-table">
                <table className="table" style={{ width: '100%', fontSize: 13 }}>
                  <tbody>
                    {invites.filter(i => !i.used_at).map(inv => (
                      <tr key={inv.id}>
                        <td data-label="Email" style={{ padding: '4px 0' }}>{inv.email}</td>
                        <td data-label="Роль" className="text-muted">{ROLE_LABEL[inv.role] ?? inv.role}</td>
                        <td data-label="Действует до" className="text-muted" style={{ fontSize: 12 }}>
                          до {new Date(inv.expires_at).toLocaleDateString('ru-RU')}
                        </td>
                        <td>
                          <button className="btn btn-secondary btn-sm" onClick={() => revokeInvite(inv.id)}>Отозвать</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card blueprint" style={{ marginTop: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Напоминания об оплате</div>
        <div className="card-body">
          <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
            За сколько дней до срока оплаты присылать email-напоминание о счетах, которые скоро нужно оплатить.
          </p>
          <form onSubmit={saveReminderSettings} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input" type="number" min={0} max={30} style={{ maxWidth: 100 }} disabled={me?.role !== 'owner'}
              value={reminderDays} onChange={e => setReminderDays(e.target.value)} />
            <span>дней до срока</span>
            {me?.role === 'owner' && (
              <button type="submit" className="btn btn-primary btn-sm" disabled={reminderSaving}>
                {reminderSaving ? 'Сохраняем…' : 'Сохранить'}
              </button>
            )}
            {reminderMsg && <span className="text-muted" style={{ fontSize: 13 }}>{reminderMsg}</span>}
          </form>
        </div>
      </div>

      {me?.role === 'owner' && (
        <div className="card blueprint" style={{ marginTop: 'var(--space-4)', borderColor: 'var(--color-accent-600)' }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-header" style={{ color: 'var(--color-accent-900)' }}>Удаление организации</div>
          <div className="card-body">
            <p className="text-muted" style={{ fontSize: 13.5, marginBottom: 12 }}>
              Организация, все её счета, платежи, контрагенты, документы и учётные записи
              сотрудников будут удалены безвозвратно (152-ФЗ: отзыв согласия на обработку
              персональных данных). Отменить это действие невозможно.
            </p>
            {!delConfirmOpen ? (
              <button className="btn btn-secondary btn-sm" style={{ color: 'var(--color-accent-900)', borderColor: 'var(--color-accent-600)' }} onClick={() => setDelConfirmOpen(true)}>
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
                {delError && <div className="error-box">{delError}</div>}
                <div className="form-group" style={{ maxWidth: 320 }}>
                  <label className="field-label">Введите пароль для подтверждения</label>
                  <input className="input" type="password" required value={delPassword} onChange={e => setDelPassword(e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="submit" className="btn btn-sm" style={{ color: 'var(--color-bg)', background: 'var(--color-accent-900)', borderColor: 'var(--color-accent-900)' }} disabled={deleting}>
                    {deleting ? 'Удаляем…' : 'Удалить навсегда'}
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setDelConfirmOpen(false); setDelPassword(''); setDelError(''); }}>
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
