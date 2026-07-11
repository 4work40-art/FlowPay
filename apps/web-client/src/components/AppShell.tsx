'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { getToken, getStoredUser, clearSession, type StoredUser } from '@/lib/auth';

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/invoices',  icon: '📋', label: 'Счета'     },
  { href: '/payments',  icon: '💳', label: 'Платежи'   },
  { href: '/analytics', icon: '📈', label: 'Аналитика' },
];

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner', accountant: 'Бухгалтер', vendor_admin: 'Vendor Admin', readonly: 'Read only',
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser]     = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (pathname === '/login') { setChecked(true); return; }
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
  }, [pathname, router]);

  if (pathname === '/login') return <>{children}</>;

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
            <a key={n.href} href={n.href} className="nav-item">
              <span>{n.icon}</span>
              <span>{n.label}</span>
            </a>
          ))}
          {user?.is_platform_admin && (
            <a href="/admin" className="nav-item" style={{ marginTop: 8, borderTop: '1px solid rgba(0,0,0,.08)', paddingTop: 16 }}>
              <span>👑</span>
              <span>Кабинет создателя</span>
            </a>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="avatar">{initials}</div>
          <div style={{ flex: 1 }}>
            <div className="avatar-name">{user?.name ?? '—'}</div>
            <div className="avatar-role">{ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {user?.plan}</div>
          </div>
          <button className="btn btn-sm" onClick={logout} title="Выйти">⏻</button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  );
}
