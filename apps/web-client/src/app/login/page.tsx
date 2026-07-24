'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';

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
    <div className="fp-wrap">
      <form onSubmit={submit} className="card blueprint fp-panel">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="fp-brand-block">
          <div className="fp-brand-mark">+</div>
          <div className="fp-brand-title">Счёт&amp;Контроль</div>
          <div className="fp-brand-sub">Вход в систему</div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="field">
          <label htmlFor="login-email">Email</label>
          <input id="login-email" className="input" type="email" required placeholder="you@company.ru"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        <div className="field">
          <div className="fp-row-between">
            <label htmlFor="login-password" style={{ margin: 0 }}>Пароль</label>
            <Link href="/forgot-password" className="fp-link">Забыли пароль?</Link>
          </div>
          <input id="login-password" className="input" type="password" required
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading} style={{ marginTop: 6 }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          {loading ? 'Входим…' : 'Войти'}
        </button>

        <div className="fp-foot-link">Нет аккаунта? <Link href="/register">Зарегистрировать организацию</Link></div>

        <div className="fp-footer">
          <ShieldCheck strokeWidth={1.5} />
          <span>Данные шифруются, каждая организация видит только свои счета</span>
        </div>
      </form>
    </div>
  );
}
