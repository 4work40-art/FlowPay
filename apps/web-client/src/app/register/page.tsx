'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

export default function RegisterPage() {
  const router = useRouter();
  const [orgName,  setOrgName]  = useState('');
  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [consent,  setConsent]  = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!consent) { setError('Нужно согласие на обработку персональных данных'); return; }
    setLoading(true);
    try {
      const res = await api.auth.register({ org_name: orgName, email, password, name, consent });
      setSession(res.data.access_token, res.data.user);
      router.replace('/dashboard');
    } catch (e: any) {
      setError(e.message || 'Не удалось зарегистрироваться');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell" style={{ padding: '32px 24px' }}>
      <form onSubmit={submit} className="card blueprint auth-card" style={{ maxWidth: 420 }}>
        <Corners />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div className="auth-brand">+</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.02em' }}>Счёт&amp;Контроль</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>Регистрация организации</div>
        </div>

        {error && (
          <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>
        )}

        <div className="field">
          <label htmlFor="reg-org">Название организации</label>
          <input id="reg-org" className="input" type="text" required value={orgName} onChange={e => setOrgName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="reg-name">Ваше имя</label>
          <input id="reg-name" className="input" type="text" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="reg-email">Email</label>
          <input id="reg-email" className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="reg-password">Пароль (минимум 8 символов)</label>
          <input id="reg-password" className="input" type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        <label style={{ display: 'flex', gap: 8, fontSize: 11.5, color: 'var(--color-neutral-700)', margin: '2px 0 16px', cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2, width: 'auto', minHeight: 'auto' }} />
          <span>
            Я согласен(на) с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link> и{' '}
            <Link href="/offer" target="_blank">публичной офертой</Link>, даю согласие на обработку
            персональных данных в соответствии с 152-ФЗ
          </span>
        </label>

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading}>
          <Corners />
          {loading ? 'Создаём…' : 'Зарегистрироваться'}
        </button>

        <div style={{ textAlign: 'center', fontSize: 13, marginTop: 6 }}>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)', fontSize: 11.5 }}>
          <ShieldCheck size={14} strokeWidth={1.5} />
          <span>Данные вашей организации не видны другим пользователям сервиса</span>
        </div>
      </form>
    </div>
  );
}
