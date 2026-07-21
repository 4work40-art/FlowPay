'use client';
import { useEffect, useState } from 'react';
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

export default function AnalyticsPage() {
  const [summary,  setSummary]  = useState<any>(null);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [audit,    setAudit]    = useState<any[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      api.dashboard.summary(),
      api.invoices.list({ limit: '100' }),
      api.audit.logs({ limit: '20' }),
    ])
      .then(([s, inv, a]) => { setSummary(s.data); setInvoices(inv.data?.items ?? []); setAudit(a.data?.items ?? []); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

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
        <a href="/analytics/items" className="btn btn-sm">📦 Учёт товаров/услуг</a>
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

      <div className="card">
        <div className="card-header">Audit Log — последние события</div>
        <div>
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
        </div>
      </div>
    </div>
  );
}
