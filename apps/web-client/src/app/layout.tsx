import type { Metadata } from 'next';
import '../styles/globals.css';

export const metadata: Metadata = {
  title: 'Счёт&Контроль',
  description: 'Единый центр контроля счётов и оплат',
};

const NAV = [
  { href: '/dashboard', icon: '📊', label: 'Dashboard' },
  { href: '/invoices',  icon: '📋', label: 'Счета'     },
  { href: '/payments',  icon: '💳', label: 'Платежи'   },
  { href: '/analytics', icon: '📈', label: 'Аналитика' },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <div className="app-shell">
          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-logo">
              <div className="sidebar-logo-title">
                <span>📄</span>
                <span>Счёт&amp;Контроль</span>
              </div>
              <div className="sidebar-logo-sub">ООО СтройМонтаж</div>
            </div>
            <nav className="sidebar-nav">
              {NAV.map(n => (
                <a key={n.href} href={n.href} className="nav-item">
                  <span>{n.icon}</span>
                  <span>{n.label}</span>
                </a>
              ))}
            </nav>
            <div className="sidebar-footer">
              <div className="avatar">ИИ</div>
              <div>
                <div className="avatar-name">Иванов И.И.</div>
                <div className="avatar-role">Owner · Free</div>
              </div>
            </div>
          </aside>

          {/* Main */}
          <main className="main-content">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
