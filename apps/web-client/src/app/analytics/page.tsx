'use client';
import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { api, fmt } from '@/lib/api';

const AGING_BUCKETS = [
  { key: '0-30',  label: '0–30 дней',   max: 30  },
  { key: '30-60', label: '30–60 дней',  max: 60  },
  { key: '60-90', label: '60–90 дней',  max: 90  },
  { key: '90+',   label: '90+ дней',    max: Infinity },
];
const AGING_SHADE: Record<string, string> = {
  '0-30': 'var(--color-accent-300)', '30-60': 'var(--color-accent-500)',
  '60-90': 'var(--color-accent-700)', '90+': 'var(--color-accent-900)',
};

function computeAging(invoices: any[]) {
  const now = Date.now();
  const buckets = Object.fromEntries(AGING_BUCKETS.map(b => [b.key, { count: 0, sum: 0 }]));
  for (const inv of invoices) {
    if (!inv.due_date || +inv.remaining_kopecks <= 0) continue;
    const daysPast = Math.floor((now - new Date(inv.due_date).getTime()) / 86400000);
    if (daysPast <= 0) continue;
    const bucket = AGING_BUCKETS.find(b => daysPast <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1];
    buckets[bucket.key].count += 1;
    buckets[bucket.key].sum += +inv.remaining_kopecks;
  }
  return buckets;
}

type RatingItem = {
  counterparty_id: string; name: string; inn: string | null;
  total_kopecks: number; total_display: string; share_pct: number; cumulative_pct: number; group: 'A' | 'B' | 'C';
};
const GROUP_TAG: Record<string, string> = { A: 'tag tag-accent', B: 'tag tag-outline', C: 'tag tag-neutral' };

type ItemSummary = {
  name: string; total_quantity: number; total_kopecks: number; total_display: string;
  avg_price_kopecks: number | null; avg_price_display: string | null;
  active_months: number; last_purchase_date: string | null;
};

function Corners() {
  return (<><i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" /></>);
}

export default function AnalyticsPage() {
  const [summary,  setSummary]  = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const [rating, setRating] = useState<RatingItem[]>([]);
  const [ratingTotal, setRatingTotal] = useState('');
  const [ratingLoading, setRatingLoading] = useState(true);
  const [ratingError, setRatingError] = useState('');

  const [items, setItems] = useState<ItemSummary[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [itemsError, setItemsError] = useState('');

  const [showAudit, setShowAudit] = useState(false);
  const [audit, setAudit] = useState<any[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([api.dashboard.summary(), api.invoices.list({ limit: '100' })])
      .then(([s, inv]) => { setSummary(s.data); setInvoices(inv.data?.items ?? []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));

    setRatingLoading(true);
    setRatingError('');
    api.counterparties.rating()
      .then(res => { setRating(res.data?.items ?? []); setRatingTotal(res.data?.total_display ?? ''); })
      .catch((e: Error) => setRatingError(e.message))
      .finally(() => setRatingLoading(false));

    setItemsLoading(true);
    setItemsError('');
    api.analytics.items()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setItemsError(e.message))
      .finally(() => setItemsLoading(false));
  };

  useEffect(() => { load(); }, []);

  const loadAudit = useCallback(() => {
    setAuditLoading(true);
    api.audit.logs({ limit: '20' })
      .then(res => setAudit(res.data?.items ?? []))
      .catch(() => {})
      .finally(() => setAuditLoading(false));
  }, []);

  const toggleAudit = () => {
    const next = !showAudit;
    setShowAudit(next);
    if (next && !audit.length) loadAudit();
  };

  if (loading) return <div className="loading">Загрузка...</div>;
  if (error) {
    return (
      <div className="error-box">
        <strong>Ошибка соединения:</strong> {error}
        <br />
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}><RefreshCw size={13} strokeWidth={1.5} /> Повторить</button>
      </div>
    );
  }

  const metrics = [
    { l: 'Задолженность',     v: summary?.total_debt?.display },
    { l: 'Просрочено',        v: summary?.overdue_debt?.display },
    { l: 'Оплачено в месяц',  v: summary?.paid_this_month?.display },
    { l: 'Trust Score',       v: `${summary?.trust_score ?? 50}/100` },
    { l: 'Всего счетов',      v: summary?.total_invoices ?? 0 },
    { l: 'На оплату (7д)',    v: summary?.due_7_days?.display },
  ];

  const aging = computeAging(invoices);
  const maxAging = Math.max(1, ...AGING_BUCKETS.map(b => aging[b.key].sum));
  const hasAging = AGING_BUCKETS.some(b => aging[b.key].count);

  return (
    <div>
      <h1 className="page-title" style={{ marginBottom: 20 }}>Аналитика</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', border: '1px solid var(--color-divider)', marginBottom: 24 }}>
        {metrics.map((m, i) => (
          <div key={m.l} style={{ padding: '14px 16px', borderRight: i < metrics.length - 1 ? '1px solid var(--color-divider)' : 'none' }}>
            <div className="metric-label" style={{ fontSize: 10.5 }}>{m.l}</div>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 20, fontWeight: 600 }}>{m.v ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>Возраст просроченной задолженности</div>
      <div className="card blueprint" style={{ position: 'relative', marginBottom: 24, padding: 0 }}>
        <Corners />
        {!hasAging ? (
          <div className="empty-state">Просроченных счетов нет</div>
        ) : (
          <div style={{ display: 'flex', gap: 20, padding: 20 }}>
            {AGING_BUCKETS.map(b => (
              <div key={b.key} style={{ flex: 1, textAlign: 'center' }}>
                <div style={{ height: 110, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                  <div style={{
                    width: 44,
                    height: Math.max(3, (aging[b.key].sum / maxAging) * 90),
                    background: AGING_SHADE[b.key],
                    borderRadius: 0,
                  }} />
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{fmt(aging[b.key].sum)}</div>
                <div style={{ fontSize: 11, color: 'var(--color-neutral-700)' }}>{b.label} · {aging[b.key].count} сч.</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="section-title">Рейтинг поставщиков по объёму закупок</div>
      <p style={{ fontSize: 12.5, color: 'var(--color-neutral-700)', margin: '4px 0 14px', maxWidth: '70ch' }}>
        ABC-анализ (правило Парето): <b>A</b> — первые 80% суммарного объёма закупок,{' '}
        <b>B</b> — следующие 15%, <b>C</b> — оставшиеся 5%.
        {ratingTotal && <> Всего закупок: {ratingTotal}.</>}
      </p>
      <div className="card blueprint" style={{ position: 'relative', marginBottom: 24, padding: 0 }}>
        <Corners />
        {ratingLoading ? (
          <div className="loading">Загрузка...</div>
        ) : ratingError ? (
          <div className="error-box" style={{ margin: 16 }}>{ratingError}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th style={{ width: 36 }}>#</th><th>Название</th><th style={{ width: 120 }}>ИНН</th><th style={{ width: 120 }}>Сумма закупок</th><th style={{ width: 70 }}>Доля</th><th style={{ width: 70 }}>Группа</th></tr>
              </thead>
              <tbody>
                {rating.map((r, i) => (
                  <tr key={r.counterparty_id}>
                    <td className="text-muted">{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="text-muted">{r.inn ?? '—'}</td>
                    <td style={{ fontWeight: 600 }}>{r.total_display}</td>
                    <td>{r.share_pct}%</td>
                    <td><span className={GROUP_TAG[r.group]}>{r.group}</span></td>
                  </tr>
                ))}
                {!rating.length && <tr><td colSpan={6} className="empty-state">Пока нет закупок с привязкой к контрагенту</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-title">Учёт товаров/услуг</div>
      <div className="card blueprint" style={{ position: 'relative', marginBottom: 24, padding: 0 }}>
        <Corners />
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 18px' }}>
          <a href="/analytics/items" className="btn btn-ghost btn-sm">Подробно и динамика цен →</a>
        </div>
        {itemsLoading ? (
          <div className="loading">Загрузка...</div>
        ) : itemsError ? (
          <div className="error-box" style={{ margin: 16 }}>{itemsError}</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th style={{ width: 110 }}>Куплено, шт.</th>
                  <th style={{ width: 110 }}>Сумма закупок</th>
                  <th style={{ width: 130 }}>Средняя цена/шт.</th>
                  <th style={{ width: 130 }}>Последняя закупка</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 10).map(it => (
                  <tr key={it.name}>
                    <td><a href="/analytics/items">{it.name}</a></td>
                    <td>{it.total_quantity}</td>
                    <td>{it.total_display}</td>
                    <td>{it.avg_price_display ?? '—'}</td>
                    <td className="text-muted">{it.last_purchase_date ? new Date(it.last_purchase_date).toLocaleDateString('ru-RU') : '—'}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={5} className="empty-state">Пока нет позиций — добавьте товары/услуги в счета</td></tr>}
              </tbody>
            </table>
            {items.length > 10 && (
              <div style={{ padding: '10px 18px', fontSize: 12.5, color: 'var(--color-neutral-700)' }}>
                Показаны первые 10 из {items.length} — <a href="/analytics/items">полный список и динамика цен →</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="section-title">Журнал событий</div>
      <div className="card blueprint" style={{ position: 'relative', padding: 0 }}>
        <Corners />
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 18px', borderBottom: showAudit ? '1px solid var(--color-divider)' : 'none' }}>
          <button className="btn btn-ghost btn-sm" onClick={toggleAudit}>
            {showAudit ? 'Скрыть' : 'Показать последние события'}
          </button>
        </div>
        {showAudit && (
          <div>
            {auditLoading ? (
              <div className="loading">Загрузка...</div>
            ) : (
              <>
                {audit.map((e, i) => (
                  <div key={i} className="audit-item">
                    <div className={`audit-dot ${e.status === 'success' ? 'success' : 'error'}`} />
                    <span className="audit-action">{e.action}</span>
                    <span className="audit-detail">
                      {e.resource} {e.resource_id ? e.resource_id.slice(0, 8) + '...' : ''}
                    </span>
                    <span className="audit-time">
                      {new Date(e.timestamp).toLocaleString('ru-RU')}
                    </span>
                  </div>
                ))}
                {!audit.length && <div className="empty-state">Нет событий</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
