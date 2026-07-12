'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f6f8',
    }}>
      <form onSubmit={submit} className="card" style={{ width: 360, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Регистрация организации</div>
        </div>

        {error && (
          <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>
        )}

        <label htmlFor="reg-org" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Название организации</label>
        <input
          id="reg-org"
          type="text"
          required
          value={orgName}
          onChange={e => setOrgName(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <label htmlFor="reg-name" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Ваше имя</label>
        <input
          id="reg-name"
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <label htmlFor="reg-email" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email</label>
        <input
          id="reg-email"
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <label htmlFor="reg-password" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Пароль (минимум 8 символов)</label>
        <input
          id="reg-password"
          type="password"
          required
          minLength={8}
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 18, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#666', marginBottom: 16, cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
          <span>
            Я согласен(на) с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link> и{' '}
            <Link href="/offer" target="_blank">публичной офертой</Link>, даю согласие на обработку
            персональных данных в соответствии с 152-ФЗ
          </span>
        </label>

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginBottom: 12 }}>
          {loading ? 'Создаём…' : 'Зарегистрироваться'}
        </button>

        <div style={{ textAlign: 'center', fontSize: 13 }}>
          Уже есть аккаунт? <Link href="/login">Войти</Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18, paddingTop: 14, borderTop: '1px solid #eee', color: '#999', fontSize: 12 }}>
          <span>🔒</span>
          <span>Данные вашей организации не видны другим пользователям сервиса</span>
        </div>
      </form>
    </div>
  );
}
