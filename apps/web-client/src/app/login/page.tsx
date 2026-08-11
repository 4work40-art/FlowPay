'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';

const DISABLED_METHODS = [
  { key: 'phone', label: 'Телефон' },
  { key: 'max', label: 'MAX ID' },
  { key: 'yandex', label: 'Яндекс ID' },
] as const;

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
    <div className="fp-split">
      <div className="fp-story">
        <div className="fp-story-brand">
          <div className="fp-story-brand-mark">+</div>
          Счёт&amp;Контроль
        </div>

        <div>
          <h1>Кто мне выставил счёт, что уже оплачено — без хаоса в переписке</h1>
          <p className="fp-story-sub">
            Загрузили счёт — система сама пересчитывает остаток после каждой оплаты,
            следит за сроками и напоминает, кому вы должны.
          </p>

          <div className="fp-proof-card">
            <div className="fp-proof-label">Пример дашборда (иллюстрация)</div>
            <div className="fp-proof-row"><span>Всего задолженности</span><b>677 896 ₽</b></div>
            <div className="fp-proof-row"><span>Просрочено</span><b>6 счетов</b></div>
            <div className="fp-proof-row"><span>Статус доверия</span><b>71 из 100</b></div>
          </div>
        </div>

        <div className="fp-quote">
          «Раньше сроки оплаты жили в трёх чатах и голове бухгалтера. Теперь — в одном
          месте, и просрочки видно заранее.» <b>— пример отзыва, иллюстрация</b>
        </div>
      </div>

      <div className="fp-auth-side">
        <form onSubmit={submit} className="card fp-panel">
          <div className="fp-brand">
            <div className="fp-brand-mark">+</div>
            <div className="fp-brand-title">Счёт&amp;Контроль</div>
            <div className="fp-brand-sub">Вход в систему</div>
          </div>

          <div className="fp-method-tabs" role="tablist" aria-label="Способ входа">
            <button type="button" className="fp-method-tab active" role="tab" aria-selected="true">
              Email
            </button>
            {DISABLED_METHODS.map(m => (
              <button
                key={m.key}
                type="button"
                className="fp-method-tab"
                role="tab"
                aria-selected="false"
                disabled
                title={`Вход через ${m.label} скоро появится`}
                aria-label={`${m.label} — скоро`}
                onClick={e => e.preventDefault()}
              >
                {m.label}
                <span className="fp-method-tab-badge">Скоро</span>
              </button>
            ))}
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

          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? 'Входим…' : 'Войти'}
          </button>

          <div className="fp-foot-link">Нет аккаунта? <Link href="/register">Зарегистрировать организацию</Link></div>

          <div className="fp-footer">
            <ShieldCheck strokeWidth={1.5} />
            <span>Каждая организация видит только свои счета и контрагентов — подробнее на странице <Link href="/trust" className="fp-link">«Доверие и безопасность»</Link></span>
          </div>
        </form>
      </div>
    </div>
  );
}
