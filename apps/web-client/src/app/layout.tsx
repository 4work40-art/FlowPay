import type { Metadata } from 'next';
import '../styles/globals.css';
import AppShell from '@/components/AppShell';

export const metadata: Metadata = {
  title: 'Счёт&Контроль',
  description: 'Единый центр контроля счётов и оплат',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
