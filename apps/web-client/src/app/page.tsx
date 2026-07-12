'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (getToken()) { router.replace('/dashboard'); return; }
    setChecked(true);
  }, [router]);

  if (!checked) return null;

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
          <Link href="/pricing">Тарифы</Link>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn btn-primary btn-sm">Начать бесплатно</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 720, margin: '60px auto', padding: '0 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 34, fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}>
          Единый центр контроля счетов и оплат
        </h1>
        <p style={{ fontSize: 17, color: '#555', marginBottom: 32, lineHeight: 1.6 }}>
          Кто мне выставил счёт, что уже оплачено, а что ещё должен — без хаоса
          в переписке и таблицах. Не бухгалтерия, не ЭДО — только контроль
          обязательств и прозрачность частичных оплат.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 48 }}>
          <Link href="/register" className="btn btn-primary">Зарегистрировать организацию</Link>
          <Link href="/pricing" className="btn">Смотреть тарифы</Link>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, textAlign: 'left' }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Все счета в одном месте</div>
            <div style={{ fontSize: 13, color: '#777' }}>Статусы, сроки оплаты, остаток долга по каждому контрагенту</div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💳</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Частичные оплаты</div>
            <div style={{ fontSize: 13, color: '#777' }}>Система сама пересчитывает остаток после каждого платежа</div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Данные изолированы</div>
            <div style={{ fontSize: 13, color: '#777' }}>Каждая организация видит только свои счета и контрагентов</div>
          </div>
        </div>
      </main>

      <footer style={{ textAlign: 'center', padding: '24px 0', color: '#999', fontSize: 12 }}>
        <Link href="/privacy" style={{ color: '#999' }}>Политика конфиденциальности</Link>
        {' · '}
        <Link href="/offer" style={{ color: '#999' }}>Публичная оферта</Link>
      </footer>
    </div>
  );
}
