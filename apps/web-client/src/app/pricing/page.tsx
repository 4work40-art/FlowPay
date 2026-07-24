'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type Plan = { invoice_limit: number | null; price_kopecks: number | null; label: string };
type Plans = Record<string, Plan>;

function priceLabel(p: Plan) {
  if (p.price_kopecks === 0) return 'Бесплатно';
  if (p.price_kopecks === null) return 'По запросу';
  return `${(p.price_kopecks / 100).toLocaleString('ru-RU')} ₽/мес`;
}

export default function PublicPricingPage() {
  const [plans, setPlans] = useState<Plans | null>(null);

  useEffect(() => {
    api.billing.plans().then(r => setPlans(r.data.plans)).catch(() => {});
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>📄 Счёт&amp;Контроль</Link>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn btn-primary btn-sm">Начать бесплатно</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Тарифы</h1>
        <p style={{ textAlign: 'center', color: '#666', marginBottom: 32 }}>
          Без скрытых доплат — то, что видите здесь, то и оплачиваете. Помесячно, без обязательного годового контракта.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {plans && Object.entries(plans).map(([key, p]) => (
            <div key={key} className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{priceLabel(p)}</div>
              <div style={{ fontSize: 13, color: '#777', marginBottom: 16 }}>
                {p.invoice_limit === null ? 'Без ограничений по счетам' : `До ${p.invoice_limit} счетов`}
              </div>
              <Link href="/register" className="btn btn-sm" style={{ width: '100%', textAlign: 'center', display: 'block' }}>
                Начать
              </Link>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
