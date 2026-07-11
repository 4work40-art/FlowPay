'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<any>(null);
  const [audit,   setAudit]   = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.dashboard.summary(), api.audit.logs({ limit: '20' })])
      .then(([s, a]) => { setSummary(s.data); setAudit(a.data?.items ?? []); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;

  const metrics = [
    { l: 'Задолженность',     v: summary?.total_debt?.display,      cls: 'red'   },
    { l: 'Просрочено',        v: summary?.overdue_debt?.display,     cls: 'amber' },
    { l: 'Оплачено в месяц',  v: summary?.paid_this_month?.display,  cls: 'green' },
    { l: 'Trust Score',       v: `${summary?.trust_score ?? 50}/100`,cls: 'green' },
    { l: 'Всего счетов',      v: summary?.total_invoices ?? 0,       cls: ''      },
    { l: 'На оплату (7д)',    v: summary?.due_7_days?.display,       cls: 'blue'  },
  ];

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
