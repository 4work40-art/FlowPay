'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f5f6f8',
    }}>
      <form onSubmit={submit} className="card" style={{ width: 340, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Вход в систему</div>
        </div>

        {error && (
          <div className="error-box" style={{ marginBottom: 14 }}>{error}</div>
        )}

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Пароль</label>
        <input
          type="password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', marginBottom: 18, border: '1px solid #ddd', borderRadius: 6 }}
        />

        <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
          {loading ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
