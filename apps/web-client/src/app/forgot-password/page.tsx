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
    <div className="fp-wrap">
      <div className="card blueprint fp-panel">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />

        <div className="fp-brand">
          <div className="fp-brand-mark">+</div>
          <div className="fp-brand-title">Счёт&amp;Контроль</div>
          <div className="fp-brand-sub">Восстановление пароля</div>
        </div>

        {sent ? (
          <div>
            <div className="error-box" style={{ background: 'var(--green-light)', color: 'var(--green-dark)' }}>
              Если такой email зарегистрирован, на него отправлена ссылка для сброса пароля. Проверьте почту.
            </div>
            <Link href="/login" className="btn btn-primary btn-block blueprint" style={{ marginTop: 6 }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              ← Вернуться ко входу
            </Link>
          </div>
        ) : (
          <form onSubmit={submit}>
            {error && <div className="error-box">{error}</div>}

            <div className="field">
              <label htmlFor="fp-email">Email</label>
              <input id="fp-email" className="input" type="email" required placeholder="you@company.ru"
                value={email} onChange={e => setEmail(e.target.value)} />
            </div>

            <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading} style={{ marginTop: 6 }}>
              <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
              {loading ? 'Отправляем…' : 'Прислать ссылку для сброса'}
            </button>

            <div className="fp-foot-link">
              <Link href="/login">← Вернуться ко входу</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
