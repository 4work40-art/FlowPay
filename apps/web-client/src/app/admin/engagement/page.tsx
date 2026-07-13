'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import AdminTabs from '@/components/AdminTabs';

type Engagement = {
  total_organizations: number;
  active_30d: number;
  activation_rate: number;
  top_active: { id: string; name: string; invoices_30d: string; payments_30d: string }[];
  dormant: { id: string; name: string; last_login_at: string | null }[];
  near_limit: { id: string; name: string; invoice_limit: number; invoice_count: string }[];
};

export default function AdminEngagementPage() {
  const [data,    setData]    = useState<Engagement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.admin.engagement()
      .then(res => setData(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!data) return null;

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Вовлечённость</div>
      </div>

      <AdminTabs />

      <div style={{ background: 'var(--gray-light)', color: 'var(--gray-dark)', padding: '10px 14px', borderRadius: 8, fontSize: 12.5, marginBottom: 16 }}>
        Здесь честные показатели активности, а не финансовые метрики — платформа пока не собирает данные о выручке (см. вкладку «Доход»).
      </div>

      <div className="metric-grid">
        <div className="metric-card blue">
          <div className="metric-label">Активные организации (30 дней)</div>
          <div className="metric-value">{data.active_30d} / {data.total_organizations}</div>
        </div>
        <div className="metric-card green">
          <div className="metric-label">Доля активированных</div>
          <div className="metric-value">{data.activation_rate}%</div>
          <div className="metric-hint">завели счёт в первую неделю</div>
        </div>
        <div className="metric-card amber">
          <div className="metric-label">Приближаются к лимиту тарифа</div>
          <div className="metric-value">{data.near_limit.length}</div>
        </div>
      </div>

      <div className="grid-2" style={{ marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">Топ по активности за 30 дней</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Организация</th><th>Счетов</th><th>Платежей</th></tr></thead>
              <tbody>
                {data.top_active.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500 }}>{o.name}</td>
                    <td>{o.invoices_30d}</td>
                    <td>{o.payments_30d}</td>
                  </tr>
                ))}
                {!data.top_active.length && <tr><td colSpan={3} className="empty-state">Нет данных</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Приближаются к лимиту</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Организация</th><th>Использовано</th></tr></thead>
              <tbody>
                {data.near_limit.map(o => (
                  <tr key={o.id}>
                    <td style={{ fontWeight: 500 }}>{o.name}</td>
                    <td>{o.invoice_count} / {o.invoice_limit}</td>
                  </tr>
                ))}
                {!data.near_limit.length && <tr><td colSpan={2} className="empty-state">Никто не близок к лимиту</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Давно не заходили (30+ дней)</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Организация</th><th>Последний вход</th></tr></thead>
            <tbody>
              {data.dormant.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td style={{ color: 'var(--text2)' }}>{o.last_login_at ? new Date(o.last_login_at).toLocaleDateString('ru-RU') : 'никогда'}</td>
                </tr>
              ))}
              {!data.dormant.length && <tr><td colSpan={2} className="empty-state">Все активные организации заходили недавно</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
