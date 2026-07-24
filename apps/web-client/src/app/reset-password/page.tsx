'use client';
import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [error, setError] = useState('');
  const [done,  setDone]  = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) { setError('Пароль должен содержать не менее 8 символов'); return; }
    if (password !== confirm) { setError('Пароли не совпадают'); return; }

    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      setDone(true);
      setTimeout(() => router.replace('/login'), 2000);
    } catch (e: any) {
      setError(e.message || 'Не удалось сбросить пароль');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div className="card" style={{ width: 360, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Новый пароль</div>
        </div>

        {!token ? (
          <div className="error-box">Ссылка недействительна — токен не передан. <Link href="/forgot-password">Запросить новую</Link></div>
        ) : done ? (
          <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '10px 12px', borderRadius: 6, fontSize: 13 }}>
            Пароль изменён, переходим ко входу…
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Новый пароль</label>
            <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }} />
            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Повторите пароль</label>
            <input type="password" required minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 18, border: '1px solid #ddd', borderRadius: 6 }} />
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Сохраняем…' : 'Сохранить новый пароль'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
