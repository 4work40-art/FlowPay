'use client';
import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api.auth.forgotPassword(email);
      setSent(true);
    } catch (e: any) {
      setError(e.message || 'Не удалось отправить запрос');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8' }}>
      <div className="card" style={{ width: 360, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Восстановление пароля</div>
        </div>

        {sent ? (
          <div>
            <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '10px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
              Если такой email зарегистрирован, на него отправлена ссылка для сброса пароля. Проверьте почту.
            </div>
            <Link href="/login" className="btn btn-sm" style={{ width: '100%', textAlign: 'center', display: 'block' }}>← Вернуться ко входу</Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}
            <label htmlFor="fp-email" style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Email</label>
            <input
              id="fp-email" type="email" required value={email}
              onChange={e => setEmail(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 18, border: '1px solid #ddd', borderRadius: 6 }}
            />
            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%', marginBottom: 12 }}>
              {loading ? 'Отправляем…' : 'Прислать ссылку для сброса'}
            </button>
            <div style={{ textAlign: 'center', fontSize: 13 }}>
              <Link href="/login">← Вернуться ко входу</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
