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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.billing.plans()
      .then(r => { if (alive) setPlans(r.data.plans); })
      .catch((e: any) => { if (alive) setError(e?.message || 'Не удалось загрузить тарифы'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-gradient)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <Link href="/" style={{ fontSize: 20, fontWeight: 700, color: 'inherit', textDecoration: 'none' }}>📄 Счёт&amp;Контроль</Link>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn btn-primary btn-sm">Начать бесплатно</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 900, margin: '40px auto', padding: '0 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, textAlign: 'center' }}>Тарифы</h1>
        <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)', marginBottom: 32 }}>
          Без скрытых доплат — то, что видите здесь, то и оплачиваете. Помесячно, без обязательного годового контракта.
        </p>

        {loading && (
          <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>Загрузка тарифов…</p>
        )}
        {error && !loading && (
          <div className="card" style={{ padding: 20, textAlign: 'center' }}>
            <div style={{ marginBottom: 12 }}>Не удалось загрузить тарифы. Попробуйте обновить страницу.</div>
            <Link href="/register" className="btn btn-sm">Зарегистрироваться бесплатно</Link>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
          {plans && Object.entries(plans).filter(([, p]) => p.price_kopecks !== null).map(([key, p]) => (
            <div key={key} className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>{p.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{priceLabel(p)}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
                {p.invoice_limit === null ? 'Без ограничений по счетам' : `До ${p.invoice_limit} счетов`}
              </div>
              <Link href="/register" className="btn btn-sm" style={{ width: '100%', textAlign: 'center', display: 'block' }}>
                Начать
              </Link>
            </div>
          ))}
        </div>

        {plans && Object.entries(plans).filter(([, p]) => p.price_kopecks === null).map(([key, p]) => (
          <div
            key={key}
            className="card"
            style={{
              marginTop: 16,
              padding: 20,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{p.label}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {priceLabel(p)} · {p.invoice_limit === null ? 'Без ограничений по счетам' : `До ${p.invoice_limit} счетов`} — нужен корпоративный тариф? Свяжитесь с нами.
              </div>
            </div>
            <Link href="/register" className="btn btn-sm" style={{ whiteSpace: 'nowrap' }}>
              Обсудить условия
            </Link>
          </div>
        ))}

        <p style={{ textAlign: 'center', marginTop: 32, fontSize: 14 }}>
          Как устроена изоляция данных между организациями →{' '}
          <Link href="/trust" style={{ fontWeight: 600 }}>Безопасность и защита данных</Link>
        </p>
      </main>
    </div>
  );
}
