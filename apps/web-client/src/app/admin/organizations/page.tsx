'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Org = {
  id: string;
  name: string;
  plan: string;
  invoice_limit: number;
  is_active: boolean;
  created_at: string;
  user_count: string;
  invoice_count: string;
  debt_kopecks: string;
  debt_display: string;
};

const PLAN_LABEL: Record<string, string> = {
  free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise',
};

export default function AdminOrganizationsPage() {
  const [items,   setItems]   = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    api.admin.organizations()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Организации на платформе</div>
          <div className="page-sub">{items.length} организаций</div>
        </div>
        <a href="/admin" className="btn btn-sm">← Обзор</a>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Организация</th>
                <th>Тариф</th>
                <th>Пользователей</th>
                <th>Счетов</th>
                <th>Долг</th>
                <th>Создана</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {items.map(o => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td>{PLAN_LABEL[o.plan] ?? o.plan} <span style={{ color: 'var(--text2)', fontSize: 11 }}>· лимит {o.invoice_limit}</span></td>
                  <td>{o.user_count}</td>
                  <td>{o.invoice_count}</td>
                  <td style={{ fontWeight: 600 }}>{o.debt_display}</td>
                  <td style={{ color: 'var(--text2)', fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('ru-RU')}</td>
                  <td>
                    <span className={`status-badge ${o.is_active ? 'status-PAID' : 'status-CREATED'}`}>
                      {o.is_active ? 'Активна' : 'Отключена'}
                    </span>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr><td colSpan={7} className="empty-state">Организаций нет</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
