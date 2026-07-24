'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { setSession } from '@/lib/auth';

const ROLE_LABEL: Record<string, string> = { accountant: 'Бухгалтер', readonly: 'Только чтение' };

function AcceptInviteForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') || '';
  const [info, setInfo] = useState<{ email: string; role: string; org_name: string } | null>(null);
  const [infoError, setInfoError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!token) { setInfoError('Ссылка недействительна — токен не передан'); return; }
    api.auth.inviteInfo(token).then(r => setInfo(r.data)).catch((e: Error) => setInfoError(e.message));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!consent) { setError('Нужно согласие на обработку персональных данных'); return; }
    setLoading(true);
    try {
      const res = await api.auth.acceptInvite({ token, name, password, consent });
      setSession(res.data.access_token, res.data.user);
      router.replace('/dashboard');
    } catch (e: any) {
      setError(e.message || 'Не удалось принять приглашение');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg)' }}>
      <div className="card" style={{ width: 380, padding: 28 }}>
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
          <div style={{ color: '#888', fontSize: 13, marginTop: 4 }}>Приглашение в организацию</div>
        </div>

        {infoError && <div className="error-box">{infoError} — <Link href="/login">Войти</Link></div>}

        {info && (
          <form onSubmit={submit}>
            <div style={{ background: 'var(--green-light)', color: 'var(--green-dark)', padding: '10px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
              Вас пригласили в «{info.org_name}» как «{ROLE_LABEL[info.role] ?? info.role}» ({info.email})
            </div>

            {error && <div className="error-box" style={{ marginBottom: 12 }}>{error}</div>}

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Ваше имя</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 14, border: '1px solid #ddd', borderRadius: 6 }} />

            <label style={{ display: 'block', fontSize: 13, marginBottom: 6 }}>Придумайте пароль</label>
            <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
              style={{ width: '100%', padding: '8px 10px', marginBottom: 16, border: '1px solid #ddd', borderRadius: 6 }} />

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#666', marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} style={{ marginTop: 2 }} />
              <span>
                Я согласен(на) с <Link href="/privacy" target="_blank">политикой конфиденциальности</Link> и даю
                согласие на обработку персональных данных в соответствии с 152-ФЗ
              </span>
            </label>

            <button type="submit" className="btn btn-primary" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Присоединяемся…' : 'Присоединиться к организации'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={null}>
      <AcceptInviteForm />
    </Suspense>
  );
}
