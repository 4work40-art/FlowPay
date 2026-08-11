'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, FileText, CreditCard, Calendar, Users, BarChart3,
  Landmark, Settings, LifeBuoy, LogOut, Send, Menu, X,
} from 'lucide-react';
import { api, ROLE_LABEL, PLAN_LABEL } from '@/lib/api';
import { getToken, getStoredUser, clearSession, type StoredUser } from '@/lib/auth';
import ReminderPopup from './ReminderPopup';

// Пункты навигации сгруппированы по смыслу (а не одним сплошным списком) —
// так рельс навигации легче просматривать и не путаются несвязанные разделы.
const NAV_GROUPS: { href: string; icon: typeof LayoutDashboard; label: string }[][] = [
  [
    { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд' },
  ],
  [
    { href: '/invoices',          icon: FileText,   label: 'Счета'          },
    { href: '/outgoing-invoices', icon: Send,       label: 'Выставить счёт' },
    { href: '/payments',          icon: CreditCard, label: 'Платежи'        },
    { href: '/calendar',          icon: Calendar,   label: 'Календарь'      },
  ],
  [
    { href: '/counterparties', icon: Users,     label: 'Контрагенты' },
    { href: '/analytics',      icon: BarChart3, label: 'Аналитика'   },
  ],
  [
    { href: '/billing',  icon: Landmark, label: 'Тариф'     },
    { href: '/settings', icon: Settings, label: 'Настройки' },
  ],
];

// Нижняя навигация на мобильных (<=768px, см. globals.css) — только самые
// используемые разделы (дашборд/счета/платежи/календарь), всё остальное
// уходит в шторку «Ещё», чтобы не городить второй полноценный рельс с
// горизонтальным скроллом. Рельс .fp-rail с этой ширины прячется целиком.
const BOTTOM_NAV: { href: string; icon: typeof LayoutDashboard; label: string }[] = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Дашборд'   },
  { href: '/invoices',  icon: FileText,        label: 'Счета'     },
  { href: '/payments',  icon: CreditCard,      label: 'Платежи'   },
  { href: '/calendar',  icon: Calendar,        label: 'Календарь' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const [user, setUser]     = useState<StoredUser | null>(null);
  const [checked, setChecked] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isPublic = ['/login', '/register', '/forgot-password', '/reset-password',
    '/', '/pricing', '/privacy', '/offer', '/trust', '/accept-invite'].includes(pathname)
    || pathname.startsWith('/public/');

  // Панель управления платформой — чужой контур: другая таблица учётных
  // записей, другой токен (pa_token), другая точка входа (/admin/login).
  // AppShell не проверяет здесь клиентскую сессию и не редиректит на /login —
  // иначе владелец платформы, не залогиненный в клиентский кабинет, улетал бы
  // в клиентскую форму входа. Доступом и оболочкой заведует app/admin/layout.tsx.
  const isPlatformAdminArea = pathname.startsWith('/admin');

  useEffect(() => {
    if (isPublic || isPlatformAdminArea) { setChecked(true); return; }
    const token = getToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setUser(getStoredUser());
    setChecked(true);
  }, [pathname, router, isPublic, isPlatformAdminArea]);

  // Закрывать мобильную шторку «Ещё» при переходе на другую страницу.
  useEffect(() => { setMoreOpen(false); }, [pathname]);

  if (isPublic || isPlatformAdminArea) return <>{children}</>;

  if (!checked) {
    return <div className="loading">Проверка сессии…</div>;
  }

  const logout = async () => {
    try { await api.auth.logout(); } catch {}
    clearSession();
    router.replace('/login');
  };

  const initials = (user?.name || '').split(' ').filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase() || '—';

  return (
    <div className="app-shell">
      <aside className="fp-rail">
        <div className="fp-brand" aria-hidden="true" />
        <nav className="fp-nav" aria-label="Основная навигация">
          {NAV_GROUPS.map((group, gi) => (
            <div className="fp-nav-group" key={gi}>
              {group.map(n => {
                const Icon = n.icon;
                const active = pathname.startsWith(n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`fp-item${active ? ' active' : ''}`}
                    title={n.label}
                    aria-label={n.label}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon strokeWidth={1.5} />
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="fp-foot">
          <a
            href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.ru'}?subject=${encodeURIComponent('Счёт&Контроль — вопрос')}`}
            className="fp-item" title="Поддержка" aria-label="Поддержка">
            <LifeBuoy strokeWidth={1.5} />
          </a>
          <Link href="/settings" className="fp-avatar" title={`${user?.name ?? '—'} · ${ROLE_LABEL[user?.role ?? ''] ?? user?.role} · ${PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}`}>
            {initials}
          </Link>
          <button className="fp-item fp-item-logout" onClick={logout} title="Выйти" aria-label="Выйти">
            <LogOut strokeWidth={1.5} />
          </button>
        </div>
      </aside>

      {/* — мобильная навигация (<=768px): нижняя панель с ключевыми разделами
          + шторка «Ещё» для остального. Рельс .fp-rail на этой ширине скрыт
          через CSS (см. globals.css), это полностью отдельная разметка. — */}
      <nav className="fp-bottom-nav" aria-label="Основная навигация">
        {BOTTOM_NAV.map(n => {
          const Icon = n.icon;
          const active = pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={`fp-bottom-item${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon strokeWidth={1.5} />
              <span>{n.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          className={`fp-bottom-item${moreOpen ? ' active' : ''}`}
          aria-expanded={moreOpen}
          aria-controls="fp-more-sheet"
          onClick={() => setMoreOpen(o => !o)}
        >
          {moreOpen ? <X strokeWidth={1.5} /> : <Menu strokeWidth={1.5} />}
          <span>Ещё</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="fp-more-backdrop" onClick={() => setMoreOpen(false)} aria-hidden="true" />
      )}
      <div id="fp-more-sheet" className={`fp-more-sheet${moreOpen ? ' open' : ''}`} role="dialog" aria-label="Дополнительные разделы" aria-hidden={!moreOpen}>
        <div className="fp-more-user">
          <span className="fp-avatar">{initials}</span>
          <div>
            <div className="fp-more-user-name">{user?.name ?? '—'}</div>
            <div className="fp-more-user-sub">{ROLE_LABEL[user?.role ?? ''] ?? user?.role} · {PLAN_LABEL[user?.plan ?? ''] ?? user?.plan}</div>
          </div>
        </div>
        <div className="fp-more-grid">
          <Link href="/outgoing-invoices" className="fp-more-item" onClick={() => setMoreOpen(false)}>
            <Send strokeWidth={1.5} /> Выставить счёт
          </Link>
          <Link href="/counterparties" className="fp-more-item" onClick={() => setMoreOpen(false)}>
            <Users strokeWidth={1.5} /> Контрагенты
          </Link>
          <Link href="/analytics" className="fp-more-item" onClick={() => setMoreOpen(false)}>
            <BarChart3 strokeWidth={1.5} /> Аналитика
          </Link>
          <Link href="/billing" className="fp-more-item" onClick={() => setMoreOpen(false)}>
            <Landmark strokeWidth={1.5} /> Тариф
          </Link>
          <Link href="/settings" className="fp-more-item" onClick={() => setMoreOpen(false)}>
            <Settings strokeWidth={1.5} /> Настройки
          </Link>
          <a
            href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@example.ru'}?subject=${encodeURIComponent('Счёт&Контроль — вопрос')}`}
            className="fp-more-item">
            <LifeBuoy strokeWidth={1.5} /> Поддержка
          </a>
          <button type="button" className="fp-more-item fp-more-logout" onClick={logout}>
            <LogOut strokeWidth={1.5} /> Выйти
          </button>
        </div>
      </div>

      <main className="main-content">
        <ReminderPopup />
        {children}
      </main>
    </div>
  );
}
