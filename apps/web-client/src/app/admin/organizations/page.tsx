'use client';
import { useEffect, useState } from 'react';
import { api, PLAN_LABEL } from '@/lib/api';
import AdminTabs from '@/components/AdminTabs';

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

export default function AdminOrganizationsPage() {
  const [items,   setItems]   = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [query,   setQuery]   = useState('');

  useEffect(() => {
    api.admin.organizations()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">⏳ Загрузка...</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;

  const filtered = query
    ? items.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : items;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Организации на платформе</div>
          <div className="page-sub">{items.length} организаций</div>
        </div>
      </div>

      <AdminTabs />

      <div className="filter-row">
        <input
          type="text" placeholder="Поиск по названию…" style={{ maxWidth: 280 }}
          value={query} onChange={e => setQuery(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="table-wrap responsive-table">
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
              {filtered.map(o => (
                <tr key={o.id} className="clickable" onClick={() => window.location.href = `/admin/organizations/${o.id}`}>
                  <td data-label="Организация" style={{ fontWeight: 500 }}>{o.name}</td>
                  <td data-label="Тариф">{PLAN_LABEL[o.plan] ?? o.plan} <span style={{ color: 'var(--text2)', fontSize: 11 }}>· лимит {o.invoice_limit}</span></td>
                  <td data-label="Пользователей">{o.user_count}</td>
                  <td data-label="Счетов">{o.invoice_count}</td>
                  <td data-label="Долг" className="tnum" style={{ fontWeight: 600 }}>{o.debt_display}</td>
                  <td data-label="Создана" style={{ color: 'var(--text2)', fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('ru-RU')}</td>
                  <td data-label="Статус">
                    {!o.is_active ? (
                      <span className="health-chip bad"><i />Отключена</span>
                    ) : Number(o.debt_kopecks) > 0 ? (
                      <span className="health-chip warn"><i />Есть долг</span>
                    ) : (
                      <span className="health-chip good"><i />Стабильно</span>
                    )}
                  </td>
                </tr>
              ))}
              {!filtered.length && (
                <tr><td colSpan={7} className="empty-state">{query ? 'Ничего не найдено' : 'Организаций нет'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
