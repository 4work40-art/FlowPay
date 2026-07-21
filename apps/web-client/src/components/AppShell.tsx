'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';
import { getToken, getStoredUser, clearSession, type StoredUser } from '@/lib/auth';

const NAV = [
  { href: '/dashboard',      icon: '📊', label: 'Дашборд'      },
  { href: '/invoices',       icon: '📋', label: 'Счета'        },
  { href: '/payments',       icon: '💳', label: 'Платежи'      },
  { href: '/calendar',       icon: '📅', label: 'Календарь'    },
  { href: '/counterparties', icon: '🤝', label: 'Контрагенты'  },
  { href: '/analytics',      icon: '📈', label: 'Аналитика'    },
  { href: '/billing',        icon: '💰', label: 'Тариф'        },
  { href: '/settings',       icon: '⚙️', label: 'Настройки'    },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser]     = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  const isPublic = ['/login', '/register', '/forgot-password', '/reset-password',
    '/', '/pricing', '/privacy', '/offer', '/accept-invite'].includes(pathname)
    || pathname.startsWith('/public/');

  useEffect(() => {
    if (isPublic) { setChecked(true); return; }
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    const stored = getStoredUser();
    if (pathname.startsWith('/admin') && !stored?.is_platform_admin) {
      router.replace('/dashboard');
      return;
    }
    setUser(stored);
    setChecked(true);
  }, [pathname, router, isPublic]);

  if (isPublic) return <>{children}</>;

  if (!checked) {
    return <div className="loading">⏳ Проверка сессии...</div>;
  }

  const logout = async () => {
    try { await api.auth.logout(); } catch {}
    clearSession();
    router.replace('/login');
  };

  const initials = (user?.name || '').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '—';

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">
            <span>📄</span>
            <span>Счёт&amp;Контроль</span>
          </div>
          <div className="sidebar-logo-sub">{user?.org_name ?? '—'}</div>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <Link key={n.href} href={n.href} className={`nav-item${pathname.startsWith(n.href) ? ' active' : ''}`}>
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </Link>
          ))}
          {user?.is_platform_admin && (
            <Link href="/admin" className={`nav-item${pathname.startsWith('/admin') ? ' active' : ''}`} style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 16 }}>
              <span>👑</span>
              <span>Кабинет создателя</span>
            </Link>
          )}
          <a
            href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.ru'}?subject=${encodeURIComponent('Счёт&Контроль — вопрос')}`}
            className="nav-item" style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 16 }}>
            <span>✉️</span>
            <span>Поддержка</span>
          </a>
        </nav>
        <div className="sidebar-footer">
          <Link href="/settings" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, color: 'inherit', textDecoration: 'none' }}>
            <div className="avatar">{initials}</div>
            <div style={{ flex: 1 }}>
              <div className="avatar-name">{user?.name ?? '—'}</div>
              <div className="avatar-role">{ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}</div>
            </div>
          </Link>
          <button className="btn btn-sm" onClick={logout} title="Выйти" aria-label="Выйти">⏻</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
