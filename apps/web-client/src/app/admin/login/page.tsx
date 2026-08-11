'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { api, setPlatformToken } from '@/lib/api';

// Вход в панель управления платформой. Намеренно САМОСТОЯТЕЛЬНАЯ страница,
// а не переиспользование формы клиентского /login: у них разные эндпоинты,
// разные хранилища токена и разные последствия компрометации. Общий компонент
// рано или поздно привёл бы к «одному маленькому пропу», который смешивает
// два контура обратно.
export default function PlatformAdminLoginPage() {
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
      const res = await api.platformAuth.login(email, password);
      setPlatformToken(res.data.access_token);
      router.replace('/admin');
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

        <div className="fp-brand">
          <div className="fp-brand-mark">+</div>
          <div className="fp-brand-title">Счёт&amp;Контроль</div>
          <div className="fp-brand-sub">Управление платформой</div>
        </div>

        {error && <div className="error-box">{error}</div>}

        <div className="field">
          <label htmlFor="admin-email">Email</label>
          <input id="admin-email" className="input" type="email" required autoComplete="username"
            value={email} onChange={e => setEmail(e.target.value)} />
        </div>

        <div className="field">
          <label htmlFor="admin-password">Пароль</label>
          <input id="admin-password" className="input" type="password" required autoComplete="current-password"
            value={password} onChange={e => setPassword(e.target.value)} />
        </div>

        <button type="submit" className="btn btn-primary btn-block blueprint" disabled={loading} style={{ marginTop: 6 }}>
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          {loading ? 'Входим…' : 'Войти'}
        </button>

        {/* Ни ссылки на регистрацию, ни восстановления пароля: учётные записи
            платформы не самообслуживаются и не создаются через веб. */}
        <div className="fp-footer">
          <ShieldCheck strokeWidth={1.5} />
          <span>Служебный вход. Клиентские учётные записи здесь не действуют.</span>
        </div>
      </form>
    </div>
  );
}
