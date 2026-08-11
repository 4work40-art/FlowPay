import type { Metadata } from 'next';
import '../styles/globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Счёт&Контроль',
  description: 'Единый центр контроля счётов и оплат',
};

// Синхронный inline-скрипт в <head> — проставляет data-theme на <html> ДО
// первой отрисовки, чтобы не было мигания неправильной темой (FOUC) при
// перезагрузке/первом визите. Приоритет: сохранённый выбор в localStorage →
// иначе системная тема (prefers-color-scheme). Сама тема живёт как
// CSS custom properties, переопределяемые через [data-theme="dark"] в
// globals.css (см. ThemeToggle.tsx для логики переключения по клику).
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'dark' || stored === 'light'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
