'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type ItemSummary = {
  name: string;
  total_quantity: number;
  total_kopecks: number;
  total_display: string;
  avg_price_kopecks: number | null;
  avg_price_display: string | null;
  active_months: number;
  last_purchase_date: string | null;
};

type MonthPoint = {
  month: string;
  total_quantity: number;
  total_kopecks: number;
  total_display: string;
  avg_price_kopecks: number | null;
  avg_price_display: string | null;
};

export default function ItemsAnalyticsPage() {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [history, setHistory] = useState<MonthPoint[]>([]);
  const [priceChangePct, setPriceChangePct] = useState<number | null>(null);
  const [peakMonth, setPeakMonth] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError('');
    api.analytics.items()
      .then(res => setItems(res.data?.items ?? []))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    setHistoryLoading(true);
    api.analytics.itemHistory(selected, 12)
      .then(res => {
        setHistory(res.data?.months ?? []);
        setPriceChangePct(res.data?.price_change_pct ?? null);
        setPeakMonth(res.data?.peak_month ?? null);
      })
      .catch(() => { setHistory([]); setPriceChangePct(null); setPeakMonth(null); })
      .finally(() => setHistoryLoading(false));
  }, [selected]);

  const maxTotal = Math.max(1, ...history.map(h => h.total_kopecks));

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Учёт товаров/услуг</div>
          <div className="page-sub">Количество, динамика цены за штуку, сезонность закупок</div>
        </div>
      </div>

      {loading ? (
        <div className="loading">⏳ Загрузка...</div>
      ) : error ? (
        <div className="error-box"><strong>Ошибка:</strong> {error}</div>
      ) : (
        <div className="card">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Наименование</th>
                  <th>Куплено, шт.</th>
                  <th>Сумма закупок</th>
                  <th>Средняя цена/шт.</th>
                  <th>Активных месяцев</th>
                  <th>Последняя закупка</th>
                </tr>
              </thead>
              <tbody>
                {items.map(it => (
                  <tr key={it.name} onClick={() => setSelected(it.name)}
                    style={{ cursor: 'pointer', background: selected === it.name ? 'var(--card-bg2)' : undefined }}>
                    <td>{it.name}</td>
                    <td>{it.total_quantity}</td>
                    <td>{it.total_display}</td>
                    <td>{it.avg_price_display ?? '—'}</td>
                    <td>{it.active_months}</td>
                    <td>{it.last_purchase_date ? new Date(it.last_purchase_date).toLocaleDateString('ru-RU') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <div className="empty-state">Пока нет позиций — добавьте товары/услуги в счета</div>}
          </div>
        </div>
      )}

      {selected && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">
            «{selected}» — динамика за 12 месяцев
          </div>
          <div className="card-body">
            {historyLoading ? (
              <div className="loading">⏳ Загрузка...</div>
            ) : !history.length ? (
              <div className="empty-state">Недостаточно данных</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Изменение цены</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>
                      {priceChangePct == null ? '—' : `${priceChangePct > 0 ? '+' : ''}${priceChangePct}%`}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>Пиковый месяц закупок</div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{peakMonth ?? '—'}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', height: 140, overflowX: 'auto' }}>
                  {history.map(h => (
                    <div key={h.month} style={{ textAlign: 'center', minWidth: 48 }}>
                      <div style={{ height: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <div title={`${h.total_display} · ${h.avg_price_display ?? '—'}/шт.`} style={{
                          width: 28,
                          height: Math.max(3, (h.total_kopecks / maxTotal) * 90),
                          background: h.month === peakMonth ? 'var(--blue)' : 'var(--amber)',
                          borderRadius: '3px 3px 0 0',
                        }} />
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--text2)', marginTop: 4 }}>{h.month.slice(5)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
