'use client';
import { useEffect, useState } from 'react';
import { api, PLAN_LABEL } from '@/lib/api';
import AdminTabs from '@/components/AdminTabs';

type Overview = {
  organizations: number;
  users: number;
  invoices: number;
  payments: number;
  paying_organizations: number;
  new_orgs_30d: number;
  active_orgs_30d: number;
  conversion_pct: number;
  active_pct: number;
  mrr: { display: string };
  revenue_month: { display: string };
  revenue_total: { display: string };
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
  const conversion = Math.min(100, data.conversion_pct);
  const activePct = Math.min(100, data.active_pct);
  const gaugeDeg = (pct: number) => `${pct * 1.8}deg`;
  const gaugeRot = (pct: number) => `${pct * 1.8 - 90}deg`;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">👑 Кабинет создателя</div>
          <div className="page-sub">Показатели по всей платформе, по всем организациям</div>
        </div>
      </div>

      <AdminTabs />

      <div className="metric-grid">
        <div className="metric-card feature">
          <div className="metric-label">MRR — доход в месяц по тарифам</div>
          <div className="metric-value">{data.mrr.display}</div>
        </div>
        <div className="metric-card green">
          <div className="metric-label">Доход за текущий месяц</div>
          <div className="metric-value">{data.revenue_month.display}</div>
          <div className="metric-hint">всего получено: {data.revenue_total.display}</div>
        </div>
        <div className="metric-card purple">
          <div className="metric-label">Организаций</div>
          <div className="metric-value">{data.organizations}</div>
          <div className="metric-hint">+{data.new_orgs_30d} за 30 дней · {data.users} пользователей</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Платящих организаций</div>
          <div className="metric-value">{data.paying_organizations}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Использование сервиса</div>
          <div className="metric-value">{data.invoices}</div>
          <div className="metric-hint">счетов · {data.payments} платежей проведено</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Рост: новые организации по неделям</div>
          <div className="card-body">
            <div className="sparkbar">
              {data.growth.map(g => (
                <b
                  key={g.week}
                  className={g.organizations ? '' : 'zero'}
                  style={{ height: `${Math.max(3, (g.organizations / maxGrowth) * 100)}%` }}
                  title={`${g.week}: ${g.organizations}`}
                />
              ))}
            </div>
            <div className="sparkbar-axis">
              <span>{data.growth[0]?.week.slice(5)}</span>
              <span>{data.growth[data.growth.length - 1]?.week.slice(5)}</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Здоровье бизнеса</div>
          <div className="card-body">
            <div className="gauge-wrap" style={{ justifyContent: 'space-around', width: '100%' }}>
              <div style={{ textAlign: 'center' }}>
                <div className="gauge" style={{ width: 140, height: 78, margin: '0 auto' }}>
                  <div className="gauge-track" style={{ width: 140, height: 140 }} />
                  <div className="gauge-fill" style={{ width: 140, height: 140, ['--gauge-deg' as any]: gaugeDeg(conversion) }} />
                  <div className="gauge-mask" style={{ top: 11, left: 11, width: 118, height: 118 }} />
                  <div className="gauge-needle" style={{ left: 70, height: 62, ['--gauge-rot' as any]: gaugeRot(conversion) }} />
                </div>
                <div className="metric-value tnum" style={{ fontSize: 17 }}>{conversion}%</div>
                <div className="metric-hint">Конверсия в платящих</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div className="gauge" style={{ width: 140, height: 78, margin: '0 auto' }}>
                  <div className="gauge-track" style={{ width: 140, height: 140 }} />
                  <div className="gauge-fill" style={{ width: 140, height: 140, ['--gauge-deg' as any]: gaugeDeg(activePct) }} />
                  <div className="gauge-mask" style={{ top: 11, left: 11, width: 118, height: 118 }} />
                  <div className="gauge-needle" style={{ left: 70, height: 62, ['--gauge-rot' as any]: gaugeRot(activePct) }} />
                </div>
                <div className="metric-value tnum" style={{ fontSize: 17 }}>{activePct}%</div>
                <div className="metric-hint">Активны за 30 дней ({data.active_orgs_30d} орг.)</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Распределение по тарифам</div>
        <div className="card-body">
          {Object.entries(data.plan_distribution).length === 0 && <div className="empty-state">Нет данных</div>}
          {Object.entries(data.plan_distribution).map(([plan, count]) => {
            const maxPlan = Math.max(1, ...Object.values(data.plan_distribution));
            return (
              <div key={plan} className="progress-track-row">
                <div className="progress-track-top">
                  <span>{PLAN_LABEL[plan] ?? plan}</span>
                  <strong className="tnum">{count}</strong>
                </div>
                <div className="progress-track">
                  <div className="progress-track-fill" style={{ width: `${(count / maxPlan) * 100}%` }} />
                </div>
              </div>
            );
          })}
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
