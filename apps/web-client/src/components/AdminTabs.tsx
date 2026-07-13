'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/admin',             label: 'Обзор'         },
  { href: '/admin/organizations', label: 'Организации' },
  { href: '/admin/engagement',  label: 'Вовлечённость' },
  { href: '/admin/revenue',     label: 'Доход'          },
];

export default function AdminTabs() {
  const pathname = usePathname();
  return (
    <div className="filter-row" style={{ marginBottom: 20 }}>
      {TABS.map(t => (
        <Link
          key={t.href}
          href={t.href}
          className={`filter-pill${pathname === t.href ? ' active' : ''}`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
