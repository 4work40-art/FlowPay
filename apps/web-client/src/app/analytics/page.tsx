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
const GROUP_TAG: Record<string, string> = {
  A: 'tag tag-accent', B: 'tag tag-outline', C: 'tag tag-neutral',
};

type ItemSummary = {
  name: string; total_quantity: number; total_kopecks: number; total_display: string;
  avg_price_kopecks: number | null; avg_price_display: string | null;
  active_months: number; last_purchase_date: string | null;
};

type ForecastWeek = {
  key: string; label: string; range_days: { from: number; to: number } | null;
  kopecks: number; display: string; invoice_count: number;
  avg_trust_score: number | null; risk_share_pct: number;
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

  const [forecast, setForecast] = useState<ForecastWeek[]>([]);
  const [forecastLoading, setForecastLoading] = useState(true);
  const [forecastError, setForecastError] = useState('');

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

    setForecastLoading(true);
    setForecastError('');
    api.dashboard.cashflowForecast()
      .then(res => setForecast(res.data?.weeks ?? []))
      .catch((e: Error) => setForecastError(e.message))
      .finally(() => setForecastLoading(false));
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

  if (loading) return <div className="loading">Загрузка…</div>;
  if (error) {
    return (
      <div className="error-box">
        <strong>Ошибка соединения:</strong> {error}
        <br />
        <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}><RefreshCw size={14} strokeWidth={1.5} /> Повторить</button>
      </div>
    );
  }

  const metrics = [
    { l: 'Задолженность',     v: summary?.total_debt?.display       },
    { l: 'Просрочено',        v: summary?.overdue_debt?.display     },
    { l: 'Оплачено в месяц',  v: summary?.paid_this_month?.display  },
    { l: 'Trust Score',       v: `${summary?.trust_score ?? 50}/100`},
    { l: 'Всего счетов',      v: summary?.total_invoices ?? 0       },
    { l: 'На оплату (7д)',    v: summary?.due_7_days?.display       },
  ];

  const aging = computeAging(invoices);
  const maxAging = Math.max(1, ...AGING_BUCKETS.map(b => aging[b.key].sum));
  // shade bars across the accent ramp, light -> dark
  const AGING_SHADE = ['var(--color-accent-300)', 'var(--color-accent-500)', 'var(--color-accent-700)', 'var(--color-accent-900)'];

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Аналитика</div>
      </div>

      <div className="metric-grid">
        {metrics.map(m => (
          <div key={m.l} className="metric-card blueprint">
            <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
            <div className="metric-label">{m.l}</div>
            <div className="metric-value">{m.v ?? '—'}</div>
          </div>
        ))}
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Возраст просроченной задолженности</div>
        <div className="card-body">
          {maxAging <= 1 && !AGING_BUCKETS.some(b => aging[b.key].count) ? (
            <div className="empty-state">Просроченных счетов нет</div>
          ) : (
            <div style={{ display: 'flex', gap: 16 }}>
              {AGING_BUCKETS.map((b, i) => (
                <div key={b.key} style={{ flex: 1, textAlign: 'center' }}>
                  <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                    <div style={{
                      width: 40,
                      height: Math.max(3, (aging[b.key].sum / maxAging) * 90),
                      background: AGING_SHADE[i],
                    }} />
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{fmt(aging[b.key].sum)}</div>
                  <div className="text-muted" style={{ fontSize: 11 }}>{b.label} · {aging[b.key].count} сч.</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span>Прогноз кассовых разрывов</span>
          {forecast.length > 0 && (
            <span className="text-muted" style={{ fontWeight: 400 }}>
              К оплате за {forecast.length - 1} недель: {fmt(forecast.reduce((s, w) => s + w.kopecks, 0))}
            </span>
          )}
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p className="text-muted" style={{ fontSize: 13, margin: '10px 0 14px' }}>
            Неоплаченные входящие счета по неделям (на основе срока оплаты <code>due_date</code>).
            Красным — доля суммы недели, приходящаяся на контрагентов с низким Trust Score
            (&lt; 40) — эти деньги статистически чаще уходят в просрочку.
          </p>
        </div>
        {forecastLoading ? (
          <div className="card-body"><div className="loading">Загрузка…</div></div>
        ) : forecastError ? (
          <div className="card-body"><div className="error-box">{forecastError}</div></div>
        ) : !forecast.some(w => w.kopecks > 0) ? (
          <div className="card-body"><div className="empty-state">Нет неоплаченных счетов с заполненным сроком оплаты</div></div>
        ) : (
          <div className="card-body" style={{ paddingTop: 0 }}>
            <div style={{ display: 'flex', gap: 12, overflowX: 'auto' }}>
              {forecast.map(w => {
                const maxForecast = Math.max(1, ...forecast.map(x => x.kopecks));
                const total = Math.max(3, (w.kopecks / maxForecast) * 90);
                const riskHeight = total * (w.risk_share_pct / 100);
                return (
                  <div key={w.key} style={{ flex: '0 0 84px', textAlign: 'center' }}>
                    <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                      <div style={{ width: 40, height: total, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                        {w.risk_share_pct > 0 && (
                          <div style={{ width: '100%', height: riskHeight, background: 'var(--tag-pink-text)' }} />
                        )}
                        <div style={{
                          width: '100%',
                          height: total - riskHeight,
                          background: w.key === 'overdue' ? 'var(--color-accent-900)' : 'var(--color-accent-500)',
                        }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 600, marginTop: 6 }}>{w.display}</div>
                    <div className="text-muted" style={{ fontSize: 11 }}>{w.label} · {w.invoice_count} сч.</div>
                    {w.kopecks > 0 && (
                      <div className="text-muted" style={{ fontSize: 10 }}>
                        Trust {w.avg_trust_score ?? '—'}{w.risk_share_pct > 0 ? ` · риск ${w.risk_share_pct}%` : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span>Рейтинг поставщиков по объёму закупок</span>
          {ratingTotal && <span className="text-muted" style={{ fontWeight: 400 }}>Всего закупок: {ratingTotal}</span>}
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <p className="text-muted" style={{ fontSize: 13, margin: '10px 0 14px' }}>
            ABC-анализ (правило Парето): <b>A</b> — первые 80% суммарного объёма
            закупок, <b>B</b> — следующие 15%, <b>C</b> — оставшиеся 5%.
            Считается по сумме выставленных счетов, не по факту оплаты.
          </p>
        </div>
        {ratingLoading ? (
          <div className="card-body"><div className="loading">Загрузка…</div></div>
        ) : ratingError ? (
          <div className="card-body"><div className="error-box">{ratingError}</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Название</th><th>ИНН</th><th>Сумма закупок</th><th>Доля</th><th>Группа</th></tr>
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

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span>Учёт товаров/услуг</span>
          <a href="/analytics/items" className="btn btn-ghost btn-sm">Подробно и динамика цен →</a>
        </div>
        {itemsLoading ? (
          <div className="card-body"><div className="loading">Загрузка…</div></div>
        ) : itemsError ? (
          <div className="card-body"><div className="error-box">{itemsError}</div></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
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
              <div className="text-muted" style={{ padding: 'var(--space-3)', fontSize: 13 }}>
                Показаны первые 10 из {items.length} — <a href="/analytics/items">полный список и динамика цен →</a>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card blueprint">
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span>Журнал событий (Audit Log)</span>
          <button className="btn btn-secondary btn-sm" onClick={toggleAudit}>
            {showAudit ? 'Скрыть' : 'Показать последние события'}
          </button>
        </div>
        {showAudit && (
          <div>
            {auditLoading ? (
              <div className="card-body"><div className="loading">Загрузка…</div></div>
            ) : (
              <>
                {audit.map((e, i) => (
                  <div key={i} className="audit-item">
                    <div className={`audit-dot ${e.status === 'success' ? '' : 'error'}`} />
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
