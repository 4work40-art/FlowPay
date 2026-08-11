'use client';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api, getPlatformToken, clearPlatformSession } from '@/lib/api';

// Сегментный layout контура /admin. Существует ровно затем, чтобы у панели
// управления платформой была СВОЯ проверка доступа и своя оболочка:
//  * охраняет pa_token и уводит на /admin/login (а не на клиентский /login);
//  * не рендерит ни рельс навигации кабинета, ни нижнюю мобильную панель —
//    у платформенного администратора нет ни организации, ни счетов, ни
//    настроек, и ссылки туда вели бы в чужой контур.
// AppShell со своей стороны для pathname.startsWith('/admin') отдаёт children
// как есть, поэтому клиентская оболочка сюда не попадает (см. AppShell.tsx).
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [checked, setChecked] = useState(false);

  // Страница входа — единственная в сегменте, доступная без токена.
  const isLoginPage = pathname === '/admin/login';

  useEffect(() => {
    if (isLoginPage) { setChecked(true); return; }
    if (!getPlatformToken()) {
      router.replace('/admin/login');
      return;
    }
    setChecked(true);
  }, [pathname, router, isLoginPage]);

  const logout = async () => {
    try { await api.platformAuth.logout(); } catch {}
    clearPlatformSession();
    router.replace('/admin/login');
  };

  if (isLoginPage) return <>{children}</>;
  if (!checked) return <div className="loading">Проверка сессии…</div>;

  return (
    <div className="app-shell">
      <main className="main-content">
        <div className="fp-row-between" style={{ marginBottom: 12 }}>
          <span style={{ color: 'var(--text2)', fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase' }}>
            Управление платформой
          </span>
          <button type="button" className="btn btn-sm" onClick={logout}>
            <LogOut strokeWidth={1.5} size={14} style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />
            Выйти
          </button>
        </div>
        {children}
      </main>
    </div>
  );
}
