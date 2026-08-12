'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/auth';

function statusTagClass(status: string) {
  return `tag status-${status}`;
}

const MOCK_ROWS = [
  { number: '0142', counterparty: 'ООО «Стройресурс»', amount: '184 300 ₽', status: 'OVERDUE', label: 'Просрочен' },
  { number: '0139', counterparty: 'ИП Ковалёва А.С.', amount: '96 500 ₽', status: 'PARTIALLY_PAID', label: 'Частично' },
  { number: '0135', counterparty: 'ООО «ТехноПоставка»', amount: '211 000 ₽', status: 'PAID', label: 'Оплачен' },
];

export default function LandingPage() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (getToken()) { router.replace('/dashboard'); return; }
    setChecked(true);
  }, [router]);

  if (!checked) return null;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg-gradient)' }}>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 32px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>📄 Счёт&amp;Контроль</div>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center', fontSize: 14 }}>
          <Link href="/pricing">Тарифы</Link>
          <Link href="/login">Войти</Link>
          <Link href="/register" className="btn btn-primary btn-sm">Начать бесплатно</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 860, margin: '0 auto', padding: '0 24px 64px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', margin: '40px auto 0' }}>
          <div
            className="tag tag-neutral"
            style={{ display: 'inline-flex', marginBottom: 20, fontSize: 12, padding: '7px 16px' }}
          >
            🔒 Данные каждой организации изолированы — проверено на сервере, не на честном слове
          </div>

          <h1 style={{ fontSize: 34, fontWeight: 700, marginBottom: 16, lineHeight: 1.3 }}>
            Единый центр контроля счетов и оплат
          </h1>
          <p style={{ fontSize: 17, color: 'var(--color-text-secondary)', marginBottom: 28, lineHeight: 1.6, maxWidth: 640, marginLeft: 'auto', marginRight: 'auto' }}>
            Кто мне выставил счёт, что уже оплачено, а что ещё должен — без хаоса
            в переписке и таблицах. Не бухгалтерия, не ЭДО — только контроль
            обязательств и прозрачность частичных оплат.
          </p>

          <div style={{ marginBottom: 12 }}>
            <Link href="/register" className="btn btn-primary">Зарегистрировать организацию — бесплатно</Link>
          </div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 48 }}>
            До 5 счетов без карты · <Link href="/pricing">Смотреть тарифы →</Link>
          </div>
        </div>

        {/* Dashboard mockup */}
        <div className="card" style={{ padding: 0, overflow: 'hidden', textAlign: 'left', marginBottom: 64 }}>
          <div style={{ display: 'flex', gap: 6, padding: '12px 16px', borderBottom: '1px solid var(--color-divider, var(--color-surface-muted))' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--tag-pink-text)', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--tag-yellow-text)', display: 'inline-block' }} />
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--tag-green-text)', display: 'inline-block' }} />
          </div>

          <div style={{ padding: 20 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                Всего задолженности
              </div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 28, fontWeight: 700 }}>
                677 896 ₽ <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)' }}>· 23 счёта в системе</span>
              </div>
            </div>

            <div className="metric-grid" style={{ marginBottom: 20 }}>
              <div className="metric-card amber">
                <div className="metric-label">Просрочено</div>
                <div className="metric-value">184 300 ₽</div>
                <div className="metric-hint">1 счёт требует внимания</div>
              </div>
              <div className="metric-card green">
                <div className="metric-label">Статус доверия</div>
                <div className="metric-value">Изоляция ОК</div>
                <div className="metric-hint">Проверено на сервере</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MOCK_ROWS.map(row => (
                <div
                  key={row.number}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-surface-muted)' }}
                >
                  <span className="mono text-muted" style={{ fontSize: 12, width: 56, flexShrink: 0 }}>#{row.number}</span>
                  <span style={{ fontWeight: 500, fontSize: 13, flex: 1 }}>{row.counterparty}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, flexShrink: 0 }}>{row.amount}</span>
                  <span className={statusTagClass(row.status)}>{row.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Features */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, textAlign: 'left', marginBottom: 64 }}>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📋</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Все счета в одном месте</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Статусы, сроки оплаты, остаток долга по каждому контрагенту</div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>💳</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Частичные оплаты</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Система сама пересчитывает остаток после каждого платежа</div>
          </div>
          <div className="card" style={{ padding: 20 }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔒</div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Данные изолированы</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>Каждая организация видит только свои счета и контрагентов</div>
          </div>
        </div>

        {/* Trust block */}
        <div style={{ textAlign: 'center', marginBottom: 64 }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Безопасность — не на честном слове</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, textAlign: 'left', marginBottom: 20 }}>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Изоляция на сервере</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Принадлежность организации определяется из данных сессии на сервере,
                а не из того, что прислал браузер.
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Пароли — только хеши</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Пароли не хранятся в открытом виде и не восстанавливаются — только
                хеш по алгоритму bcrypt.
              </div>
            </div>
            <div className="card" style={{ padding: 20 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Полный журнал действий</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                Вход в аккаунт, смена пароля, изменение статусов счетов — всё
                фиксируется в журнале аудита с указанием, кто и когда.
              </div>
            </div>
          </div>
          <Link href="/trust" style={{ fontWeight: 600, color: 'var(--color-accent)' }}>Читать подробное описание защиты данных →</Link>
        </div>

        {/* Pricing teaser */}
        <div className="card" style={{ padding: 28, textAlign: 'center' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Без скрытых доплат</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>
            Бесплатный тариф — до 5 счетов без карты. Дальше — простые тарифы без сюрпризов.
          </div>
          <Link href="/pricing" className="btn">Смотреть тарифы</Link>
        </div>
      </main>

      <footer style={{ textAlign: 'center', padding: '24px 0', color: 'var(--color-text-faint)', fontSize: 12 }}>
        <Link href="/privacy" style={{ color: 'var(--color-text-faint)' }}>Политика конфиденциальности</Link>
        {' · '}
        <Link href="/offer" style={{ color: 'var(--color-text-faint)' }}>Публичная оферта</Link>
        {' · '}
        <Link href="/trust" style={{ color: 'var(--color-text-faint)' }}>Безопасность и защита данных</Link>
      </footer>
    </div>
  );
}
