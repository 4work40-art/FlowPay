'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';

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
    <div className="fp-wrap">
      <form onSubmit={submit} className="card blueprint fp-panel" style={{ width: 400 }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="fp-brand">
          <div className="fp-brand-mark">+</div>
          <div className="fp-brand-title">Счёт&amp;Контроль</div>
          <div className="fp-brand-sub">Регистрация организации</div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="field">
          <label htmlFor="reg-org">Название организации</label>
          <input id="reg-org" className="input" required value={orgName} onChange={e => setOrgName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reg-name">Ваше имя</label>
          <input id="reg-name" className="input" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reg-email">Email</label>
          <input id="reg-email" className="input" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="reg-password">Пароль (минимум 8 символов)</label>
          <input id="reg-password" className="input" type="password" required minLength={8}
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        <label className="fp-consent">
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          <span>
            Я согласен(на) с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link> и{' '}
            <Link href="/offer" target="_blank">публичной офертой</Link>, даю согласие на обработку
            персональных данных в соответствии с 152-ФЗ
          </span>
        </label>

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          {loading ? 'Создаём…' : 'Зарегистрироваться'}
        </button>

        <div className="fp-foot-link">Уже есть аккаунт? <Link href="/login">Войти</Link></div>

        <div className="fp-footer">
          <ShieldCheck strokeWidth={1.5} />
          <span>Данные вашей организации не видны другим пользователям сервиса</span>
        </div>
      </form>
    </div>
  );
}
