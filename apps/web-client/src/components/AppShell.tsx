'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FileText, CreditCard, Calendar, Users, BarChart3,
  ShieldCheck, Settings, LifeBuoy, LogOut, Crown,
} from 'lucide-react';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';
import { getToken, getStoredUser, clearSession, type StoredUser } from '@/lib/auth';
import ReminderPopup from './ReminderPopup';

const NAV = [
  { href: '/dashboard',      icon: LayoutDashboard, label: 'Дашборд'     },
  { href: '/invoices',       icon: FileText,        label: 'Счета'       },
  { href: '/payments',       icon: CreditCard,       label: 'Платежи'     },
  { href: '/calendar',       icon: Calendar,         label: 'Календарь'   },
  { href: '/counterparties', icon: Users,            label: 'Контрагенты' },
  { href: '/analytics',      icon: BarChart3,        label: 'Аналитика'   },
  { href: '/billing',        icon: ShieldCheck,      label: 'Тариф'       },
  { href: '/settings',       icon: Settings,         label: 'Настройки'   },
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
        <div className="sidebar-logo" title="Счёт&amp;Контроль">+</div>
        <nav className="sidebar-nav">
          {NAV.map(n => {
            const Icon = n.icon;
            return (
              <Link key={n.href} href={n.href} className={`nav-item${pathname.startsWith(n.href) ? ' active' : ''}`} title={n.label} aria-label={n.label}>
                <Icon strokeWidth={1.5} />
              </Link>
            );
          })}
          {user?.is_platform_admin && (
            <Link href="/admin" className={`nav-item${pathname.startsWith('/admin') ? ' active' : ''}`} title="Кабинет создателя" aria-label="Кабинет создателя">
              <Crown strokeWidth={1.5} />
            </Link>
          )}
        </nav>
        <div className="sidebar-footer">
          <a
            href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.ru'}?subject=${encodeURIComponent('Счёт&Контроль — вопрос')}`}
            className="nav-item" title="Поддержка" aria-label="Поддержка">
            <LifeBuoy strokeWidth={1.5} />
          </a>
          <Link href="/settings" className="avatar" title={`${user?.name ?? '—'} · ${ROLE_LABEL[user?.role ?? ''] ?? user?.role} · ${PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}`}>
            {initials}
          </Link>
          <button className="nav-item" onClick={logout} title="Выйти" aria-label="Выйти" style={{ background: 'transparent', border: 'none' }}>
            <LogOut strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      <main className="main-content">
        <ReminderPopup />
        {children}
      </main>
    </div>
  );
}
