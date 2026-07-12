'use client';
import { useEffect, useState } from 'react';
import { api, PLAN_LABEL } from '@/lib/api';

type Overview = {
  organizations: number;
  users: number;
  invoices: number;
  payments: number;
  total_debt: { display: string };
  plan_distribution: Record<string, number>;
  growth: { week: string; organizations: number }[];
  recent_activity: { id: number; timestamp: string; action: string; resource: string; resource_id: string | null; status: string; org_name: string | null }[];
};

export default function AdminOverviewPage() {
  const [data,    setData]    = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.admin.overview()
      .then(res => setData(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!data) return null;

  const maxGrowth = Math.max(1, ...data.growth.map(g => g.organizations));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">👑 Кабинет создателя</div>
          <div className="page-sub">Показатели по всей платформе, across всех организаций</div>
        </div>
        <a href="/admin/organizations" className="btn btn-sm">Все организации →</a>
      </div>

      <div className="metric-grid">
        <div className="metric-card blue">
          <div className="metric-label">Организаций</div>
          <div className="metric-value">{data.organizations}</div>
        </div>
        <div className="metric-card purple">
          <div className="metric-label">Пользователей</div>
          <div className="metric-value">{data.users}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Счетов всего</div>
          <div className="metric-value">{data.invoices}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Платежей всего</div>
          <div className="metric-value">{data.payments}</div>
        </div>
        <div className="metric-card red">
          <div className="metric-label">Долг под контролем платформы</div>
          <div className="metric-value">{data.total_debt.display}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Рост: новые организации по неделям</div>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 100 }}>
              {data.growth.map(g => (
                <div key={g.week} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${g.week}: ${g.organizations}`}>
                  <div
                    style={{
                      width: '100%',
                      height: Math.max(3, (g.organizations / maxGrowth) * 80),
                      background: g.organizations ? 'var(--blue)' : 'var(--border)',
                      borderRadius: 2,
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text2)', marginTop: 6 }}>
              <span>{data.growth[0]?.week.slice(5)}</span>
              <span>{data.growth[data.growth.length - 1]?.week.slice(5)}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Распределение по тарифам</div>
          <div className="card-body">
            {Object.entries(data.plan_distribution).length === 0 && <div className="empty-state">Нет данных</div>}
            {Object.entries(data.plan_distribution).map(([plan, count]) => (
              <div key={plan} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span>{PLAN_LABEL[plan] ?? plan}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Активность по всей платформе — последние события</div>
        <div>
          {data.recent_activity.map(e => (
            <div key={e.id} className="audit-item">
              <div className={`audit-dot ${e.status === 'success' ? 'success' : 'error'}`} />
              <span className="audit-action">{e.action}</span>
              <span className="audit-detail">
                {e.org_name ?? '—'} · {e.resource} {e.resource_id ? e.resource_id.slice(0, 8) + '...' : ''}
              </span>
              <span className="audit-time">{new Date(e.timestamp).toLocaleString('ru-RU')}</span>
            </div>
          ))}
          {!data.recent_activity.length && <div className="empty-state">Нет событий</div>}
        </div>
      </div>
    </div>
  );
}
