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

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.auth.login(email, password);
      setSession(res.data.access_token, res.data.user);
      router.replace('/dashboard');
    } catch (e: any) {
      setError(e.message || 'Не удалось войти');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <form onSubmit={submit} className="card blueprint auth-card">
        <Corners />

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <div className="auth-brand">+</div>
          <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.02em' }}>Счёт&amp;Контроль</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-neutral-700)' }}>Вход в систему</div>
        </div>

        {error && (
          <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>
        )}

        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            className="input"
            type="email"
            required
            placeholder="you@company.ru"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
        </div>

        <div className="field">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <label htmlFor="login-password" style={{ margin: 0 }}>Пароль</label>
            <Link href="/forgot-password" style={{ fontSize: 12 }}>Забыли пароль?</Link>
          </div>
          <input
            id="login-password"
            className="input"
            type="password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </div>

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading} style={{ marginTop: 6 }}>
          <Corners />
          {loading ? 'Входим…' : 'Войти'}
        </button>

        <div style={{ textAlign: 'center', fontSize: 13, marginTop: 6 }}>
          Нет аккаунта? <Link href="/register">Зарегистрировать организацию</Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--color-divider)', color: 'var(--color-neutral-700)', fontSize: 11.5 }}>
          <ShieldCheck size={14} strokeWidth={1.5} />
          <span>Данные шифруются, каждая организация видит только свои счета</span>
        </div>
      </form>
    </div>
  );
}
