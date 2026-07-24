'use client';
import { useEffect, useState } from 'react';
import { api, PLAN_LABEL } from '@/lib/api';

type Plan = { invoice_limit: number | null; price_kopecks: number | null; label: string };
type Plans = Record<string, Plan>;
type Subscription = { plan: string; status: string; invoice_limit: number | null; current_period_end?: string };

function priceLabel(p: Plan) {
  if (p.price_kopecks === 0) return 'Бесплатно';
  if (p.price_kopecks === null) return 'По запросу';
  return `${(p.price_kopecks / 100).toLocaleString('ru-RU')} ₽/мес`;
}

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plans | null>(null);
  const [purchasable, setPurchasable] = useState<string[]>([]);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkoutError, setCheckoutError] = useState('');
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  useEffect(() => {
    Promise.all([api.billing.plans(), api.billing.subscription(), api.users.me()])
      .then(([p, s, m]) => { setPlans(p.data.plans); setPurchasable(p.data.purchasable); setSub(s.data); setMe(m.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const buy = async (plan: string) => {
    setCheckoutError('');
    setCheckoutPlan(plan);
    try {
      const res = await api.billing.checkout(plan);
      const url = res.data.confirmation_url;
      if (url) window.location.href = url;
      else setCheckoutError('ЮKassa не вернула ссылку на оплату');
    } catch (e: any) {
      setCheckoutError(e.message || 'Не удалось создать платёж');
    } finally {
      setCheckoutPlan(null);
    }
  };

  const cancelSubscription = async () => {
    if (!confirm('Вернуться на бесплатный тариф? Лимит счетов сразу станет прежним, оплаченный период не возвращается.')) return;
    setCancelError('');
    setCanceling(true);
    try {
      const res = await api.billing.cancel();
      setSub(s => s ? { ...s, plan: res.data.plan, invoice_limit: res.data.invoice_limit, current_period_end: undefined } : s);
    } catch (e: any) {
      setCancelError(e.message || 'Не удалось отменить подписку');
    } finally {
      setCanceling(false);
    }
  };

  if (loading) return <div className="loading">Загрузка...</div>;

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 20 }}>Тариф и биллинг</h1>

      {sub && (
        <div className="card blueprint" style={{ position: 'relative', marginBottom: 20, maxWidth: 420, padding: 20 }}>
          <Corners />
          <div style={{ fontSize: 11, color: 'var(--color-neutral-700)', textTransform: 'uppercase', marginBottom: 8 }}>Текущая подписка</div>
          <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>Тариф: </span><strong>{PLAN_LABEL[sub.plan] ?? sub.plan}</strong></div>
          <div style={{ marginBottom: 6 }}><span style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>Лимит счетов: </span><strong>{sub.invoice_limit ?? 'без ограничений'}</strong></div>
          {sub.current_period_end && (
            <div style={{ marginBottom: 14 }}><span style={{ color: 'var(--color-neutral-700)', fontSize: 13 }}>Действует до: </span><strong>{new Date(sub.current_period_end).toLocaleDateString('ru-RU')}</strong></div>
          )}
          {cancelError && <div className="error-box" style={{ marginBottom: 10 }}>{cancelError}</div>}
          {sub.plan !== 'free' && me?.role === 'owner' && (
            <button className="btn btn-ghost btn-sm" disabled={canceling} onClick={cancelSubscription}>
              {canceling ? 'Отменяем…' : 'Вернуться на бесплатный тариф'}
            </button>
          )}
        </div>
      )}

      {checkoutError && <div className="error-box" style={{ marginBottom: 16 }}>{checkoutError}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
        {plans && Object.entries(plans).map(([key, p]) => {
          const isCurrent = sub?.plan === key;
          const canBuy = purchasable.includes(key) && me?.role === 'owner';
          return (
            <div key={key} className="card blueprint" style={{ position: 'relative', padding: 20 }}>
              <Corners />
              <div className="card-kicker">{p.label}</div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 26, fontWeight: 600, marginBottom: 6 }}>{priceLabel(p)}</div>
              <div className="field-hint" style={{ marginBottom: 16 }}>
                {p.invoice_limit === null ? 'Без ограничений по счетам' : `До ${p.invoice_limit} счетов`}
              </div>

              {isCurrent ? (
                <span className="tag tag-accent">Текущий тариф</span>
              ) : canBuy ? (
                <button className="btn btn-secondary blueprint btn-sm" disabled={checkoutPlan === key} onClick={() => buy(key)}>
                  <Corners />{checkoutPlan === key ? 'Переходим к оплате…' : 'Оформить'}
                </button>
              ) : purchasable.includes(key) ? (
                <span className="field-hint">Доступно только владельцу организации</span>
              ) : (
                <span className="field-hint">Свяжитесь с нами для подключения</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
