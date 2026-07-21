'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, fmt } from '@/lib/api';

const AGING_BUCKETS = [
  { key: '0-30',  label: '0–30 дней',   max: 30  },
  { key: '30-60', label: '30–60 дней',  max: 60  },
  { key: '60-90', label: '60–90 дней',  max: 90  },
  { key: '90+',   label: '90+ дней',    max: Infinity },
];

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
const GROUP_COLOR: Record<string, string> = {
  A: 'var(--green-dark, #1a7a4c)', B: 'var(--amber-dark, #a06a00)', C: 'var(--text2, #888)',
};
const GROUP_BG: Record<string, string> = {
  A: 'var(--green-light, #e8f5ee)', B: 'var(--amber-light, #fdf1dc)', C: 'var(--border-light, #f0f0f0)',
};

type ItemSummary = {
  name: string; total_quantity: number; total_kopecks: number; total_display: string;
  avg_price_kopecks: number | null; avg_price_display: string | null;
  active_months: number; last_purchase_date: string | null;
};

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

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) {
    return (
      <div className="error-box">
        <strong>Ошибка соединения:</strong> {error}
        <br />
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}>↺ Повторить</button>
      </div>
    );
  }

  const metrics = [
    { l: 'Задолженность',     v: summary?.total_debt?.display,      cls: 'red'   },
    { l: 'Просрочено',        v: summary?.overdue_debt?.display,     cls: 'amber' },
    { l: 'Оплачено в месяц',  v: summary?.paid_this_month?.display,  cls: 'green' },
    { l: 'Trust Score',       v: `${summary?.trust_score ?? 50}/100`,cls: 'green' },
    { l: 'Всего счетов',      v: summary?.total_invoices ?? 0,       cls: ''      },
    { l: 'На оплату (7д)',    v: summary?.due_7_days?.display,       cls: 'blue'  },
  ];

  const aging = computeAging(invoices);
  const maxAging = Math.max(1, ...AGING_BUCKETS.map(b => aging[b.key].sum));

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Аналитика</div>
      </div>

      <div className="metric-grid" style={{ marginBottom: 24 }}>
        {metrics.map(m => (
          <div key={m.l} className={`metric-card${m.cls ? ' ' + m.cls : ''}`}>
            <div className="metric-label">{m.l}</div>
            <div className="metric-value">{m.v ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">Возраст просроченной задолженности</div>
        <div className="card-body">
          {maxAging <= 1 && !AGING_BUCKETS.some(b => aging[b.key].count) ? (
            <div className="empty-state">Просроченных счетов нет</div>
          ) : (
            <div style={{ display: 'flex', gap: 16 }}>
              {AGING_BUCKETS.map(b => (
                <div key={b.key} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{
                      width: 40,
                      height: Math.max(3, (aging[b.key].sum / maxAging) * 90),
                      background: b.key === '90+' ? 'var(--red)' : b.key === '60-90' ? 'var(--amber)' : 'var(--blue)',
                      borderRadius: '3px 3px 0 0',
                    }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{fmt(aging[b.key].sum)}</div>
                  <div style={{ fontSize: 11, color: 'var(--text2)' }}>{b.label} · {aging[b.key].count} сч.</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span>Рейтинг поставщиков по объёму закупок</span>
          {ratingTotal && <span style={{ color: 'var(--text2)', fontWeight: 400 }}>Всего закупок: {ratingTotal}</span>}
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text2)', margin: '10px 0 14px' }}>
            ABC-анализ (правило Парето): <b style={{ color: GROUP_COLOR.A }}>A</b> — первые 80% суммарного объёма
            закупок, <b style={{ color: GROUP_COLOR.B }}>B</b> — следующие 15%, <b style={{ color: GROUP_COLOR.C }}>C</b> — оставшиеся 5%.
            Считается по сумме выставленных счетов, не по факту оплаты.
          </p>
        </div>
        {ratingLoading ? (
          <div className="card-body"><div className="loading">⏳ Загрузка...</div></div>
        ) : ratingError ? (
          <div className="card-body"><div className="error-box">{ratingError}</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>#</th><th>Название</th><th>ИНН</th><th>Сумма закупок</th><th>Доля</th><th>Группа</th></tr>
              </thead>
              <tbody>
                {rating.map((r, i) => (
                  <tr key={r.counterparty_id}>
                    <td style={{ color: 'var(--text2)' }}>{i + 1}</td>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td style={{ color: 'var(--text2)' }}>{r.inn ?? '—'}</td>
                    <td style={{ fontWeight: 600 }}>{r.total_display}</td>
                    <td>{r.share_pct}%</td>
                    <td>
                      <span style={{ background: GROUP_BG[r.group], color: GROUP_COLOR[r.group], padding: '2px 10px', borderRadius: 12, fontWeight: 600, fontSize: 12.5 }}>
                        {r.group}
                      </span>
                    </td>
                  </tr>
                ))}
                {!rating.length && <tr><td colSpan={6} className="empty-state">Пока нет закупок с привязкой к контрагенту</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <span>Учёт товаров/услуг</span>
          <a href="/analytics/items" className="btn btn-sm">Подробно и динамика цен →</a>
        </div>
        {itemsLoading ? (
          <div className="card-body"><div className="loading">⏳ Загрузка...</div></div>
        ) : itemsError ? (
          <div className="card-body"><div className="error-box">{itemsError}</div></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Куплено, шт.</th>
                  <th>Сумма закупок</th>
                  <th>Средняя цена/шт.</th>
                  <th>Последняя закупка</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 10).map(it => (
                  <tr key={it.name}>
                    <td><a href="/analytics/items">{it.name}</a></td>
                    <td>{it.total_quantity}</td>
                    <td>{it.total_display}</td>
                    <td>{it.avg_price_display ?? '—'}</td>
                    <td>{it.last_purchase_date ? new Date(it.last_purchase_date).toLocaleDateString('ru-RU') : '—'}</td>
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={5} className="empty-state">Пока нет позиций — добавьте товары/услуги в счета</td></tr>}
              </tbody>
            </table>
            {items.length > 10 && (
              <div style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text2)' }}>
                Показаны первые 10 из {items.length} — <a href="/analytics/items">полный список и динамика цен →</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <span>Журнал событий (Audit Log)</span>
          <button className="btn btn-sm" onClick={toggleAudit}>
            {showAudit ? 'Скрыть' : 'Показать последние события'}
          </button>
        </div>
        {showAudit && (
          <div>
            {auditLoading ? (
              <div className="card-body"><div className="loading">⏳ Загрузка...</div></div>
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
