'use client';
import { useEffect, useState, useCallback } from 'react';
import { api, STATUS_LABEL, STATUS_ICON } from '@/lib/api';

type Invoice = {
  id: string;
  number: string;
  counterparty_name: string;
  amount_kopecks: number;
  paid_kopecks: number;
  remaining_kopecks: number;
  amount_display: string;
  paid_display: string;
  remaining_display: string;
  status: string;
  due_date: string;
};

export default function DashboardPage() {
  const [summary,  setSummary]  = useState<any>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [mode,     setMode]     = useState<'quick' | 'detail'>('quick');
  const [filter,   setFilter]   = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState('');
  const [acting,   setActing]   = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    Promise.all([
      api.dashboard.summary(),
      api.invoices.list({ limit: '10' }),
    ])
      .then(([s, inv]) => {
        setSummary(s.data);
        setInvoices(inv.data?.items ?? []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const doTransition = async (invoiceId: string, transition: string) => {
    setActing(invoiceId);
    try {
      await api.invoices.transition(invoiceId, transition);
      load();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    } finally {
      setActing(null);
    }
  };

  const displayed = filter
    ? invoices.filter(i => i.status === filter)
    : invoices;

  if (loading) {
    return <div className="loading">⏳ Загрузка данных...</div>;
  }

  if (error) {
    return (
      <div>
        <div className="error-box">
          <strong>Ошибка соединения:</strong> {error}
          <br />
          <span style={{ fontSize: 12, opacity: .8 }}>
            Убедись что docker compose up -d выполнен и API отвечает на http://localhost:3001/health
          </span>
          <br />
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={load}>
            ↺ Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* ─── Заголовок ───────────────────── */}
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">ООО СтройМонтаж · Owner · Free</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${mode === 'quick' ? ' active' : ''}`}
              onClick={() => setMode('quick')}>
              Quick View
            </button>
            <button
              className={`view-toggle-btn${mode === 'detail' ? ' active' : ''}`}
              onClick={() => setMode('detail')}>
              Детальный
            </button>
          </div>
          <button className="btn btn-sm" onClick={load}>↺</button>
        </div>
      </div>

      {mode === 'quick' ? (
        <>
          {/* ─── Quick View ─────────────────── */}
          <div className="grid-2" style={{ marginBottom: 16 }}>

            {/* Главная карточка долга + CTA */}
            <div className="debt-card">
              <div className="debt-label">🏦 Всего задолженности</div>
              <div className="debt-value">{summary?.total_debt?.display ?? '—'}</div>
              <div className="debt-sub">{summary?.total_invoices ?? 0} счетов в системе</div>
              <a href="/invoices/new" className="btn-cta">
                ↑ Загрузить новый счёт
              </a>
            </div>

            {/* Два алерта */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* P5: ОРАНЖЕВЫЙ для просрочки */}
              <div className="alert-card amber" role="alert">
                <div className="alert-title">⏰ Просроченные</div>
                <div className="alert-value">{summary?.overdue_debt?.display ?? '—'}</div>
                <div className="alert-sub">{summary?.overdue_debt?.count ?? 0} счетов · требуют внимания</div>
              </div>
              <div className="alert-card blue">
                <div className="alert-title">📅 На оплату (7 дней)</div>
                <div className="alert-value">{summary?.due_7_days?.display ?? '—'}</div>
                <div className="alert-sub">{summary?.due_7_days?.count ?? 0} счетов · срок истекает</div>
              </div>
            </div>
          </div>

          {/* Trust Score */}
          <div
            className="trust-card"
            aria-label={`Trust Score ${summary?.trust_score ?? 50} из 100`}>
            <div className="trust-info">
              <div className="trust-label">🛡 Статус доверия</div>
              <div className="trust-bar-wrap">
                <div
                  className="trust-bar-fill"
                  style={{ width: `${summary?.trust_score ?? 50}%` }}
                />
              </div>
              <div className="trust-sub">Надёжный партнёр · Топ 25% платформы</div>
            </div>
            <div>
              <div className="trust-score">{summary?.trust_score ?? 50}</div>
              <div className="trust-score-sub">из 100</div>
            </div>
          </div>

          {/* Таблица счетов P2: 4 колонки + expand + фильтры */}
          <div className="card">
            <div className="card-header">
              <span>Последние счета</span>
              <div className="filter-row" style={{ margin: 0 }}>
                {[
                  ['', 'Все'],
                  ['OVERDUE', '⏰ Просрочены'],
                  ['PARTIALLY_PAID', '% Частично'],
                  ['UNDER_CONTROL', '👁 На контроле'],
                  ['PAID', '✓ Оплачены'],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    className={`filter-pill${filter === v ? ' active' : ''}`}
                    onClick={() => setFilter(v)}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 70 }}>№</th>
                    <th>Контрагент</th>
                    <th style={{ width: 140 }}>Сумма</th>
                    <th style={{ width: 130 }}>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map(inv => (
                    <>
                      <tr
                        key={inv.id}
                        className="clickable"
                        onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
                        aria-expanded={expanded === inv.id}>
                        <td className="mono" style={{ color: '#888' }}>#{inv.number}</td>
                        <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                        <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                        <td>
                          <span className={`status-badge status-${inv.status}`}>
                            {STATUS_ICON[inv.status]} {STATUS_LABEL[inv.status] ?? inv.status}
                          </span>
                        </td>
                      </tr>

                      {expanded === inv.id && (
                        <tr key={`${inv.id}-exp`} className="expand-row">
                          <td colSpan={4}>
                            <div className="expand-grid">
                              <div>
                                <div className="expand-label">Оплачено</div>
                                <div className="expand-value" style={{ color: '#085041' }}>{inv.paid_display}</div>
                              </div>
                              <div>
                                <div className="expand-label">Остаток</div>
                                <div className="expand-value" style={{ color: inv.remaining_kopecks > 0 ? '#633806' : '#085041' }}>
                                  {inv.remaining_display}
                                </div>
                              </div>
                              <div>
                                <div className="expand-label">Срок оплаты</div>
                                <div className="expand-value">{inv.due_date ?? '—'}</div>
                              </div>
                            </div>
                            <div className="expand-actions">
                              {inv.status === 'CREATED' && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={acting === inv.id}
                                  onClick={e => { e.stopPropagation(); doTransition(inv.id, 'mark_for_control'); }}>
                                  👁 На контроль
                                </button>
                              )}
                              {inv.status === 'UNDER_CONTROL' && (
                                <button
                                  className="btn btn-primary btn-sm"
                                  disabled={acting === inv.id}
                                  onClick={e => { e.stopPropagation(); doTransition(inv.id, 'set_pending'); }}>
                                  ⏳ Ожидает оплаты
                                </button>
                              )}
                              {inv.status === 'PAID' && (
                                <button
                                  className="btn btn-gray btn-sm"
                                  disabled={acting === inv.id}
                                  onClick={e => { e.stopPropagation(); doTransition(inv.id, 'archive'); }}>
                                  📦 В архив
                                </button>
                              )}
                              {inv.status === 'OVERDUE' && (
                                <button
                                  className="btn btn-amber btn-sm"
                                  disabled={acting === inv.id}
                                  onClick={e => { e.stopPropagation(); doTransition(inv.id, 'write_off'); }}>
                                  ✗ Списать
                                </button>
                              )}
                              <a
                                href={`/invoices/${inv.id}`}
                                className="btn btn-sm"
                                onClick={e => e.stopPropagation()}>
                                Подробнее →
                              </a>
                              <a
                                href={`/payments?invoice=${inv.id}`}
                                className="btn btn-green btn-sm"
                                onClick={e => e.stopPropagation()}>
                                + Платёж
                              </a>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                  {!displayed.length && (
                    <tr>
                      <td colSpan={4} className="empty-state">Счетов нет</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="table-footer">
              <span>{displayed.length} из {invoices.length} счетов</span>
              <a href="/invoices">Все счета →</a>
            </div>
          </div>
        </>
      ) : (
        /* ─── Детальный вид ─────────────── */
        <>
          <div className="metric-grid">
            <div className="metric-card red">
              <div className="metric-label">Задолженность</div>
              <div className="metric-value">{summary?.total_debt?.display ?? '—'}</div>
            </div>
            <div className="metric-card amber">
              <div className="metric-label">Просрочено</div>
              <div className="metric-value">{summary?.overdue_debt?.display ?? '—'}</div>
              <div className="metric-hint">{summary?.overdue_debt?.count ?? 0} счетов</div>
            </div>
            <div className="metric-card blue">
              <div className="metric-label">На оплату (7д)</div>
              <div className="metric-value">{summary?.due_7_days?.display ?? '—'}</div>
            </div>
            <div className="metric-card green">
              <div className="metric-label">Оплачено в месяце</div>
              <div className="metric-value">{summary?.paid_this_month?.display ?? '—'}</div>
            </div>
            <div className="metric-card">
              <div className="metric-label">Всего счетов</div>
              <div className="metric-value">{summary?.total_invoices ?? 0}</div>
            </div>
            <div className="metric-card green">
              <div className="metric-label">Trust Score</div>
              <div className="metric-value">{summary?.trust_score ?? 50}/100</div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">Все счета</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Контрагент</th>
                    <th>Сумма</th>
                    <th>Остаток</th>
                    <th>Срок</th>
                    <th>Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map(inv => (
                    <tr key={inv.id}>
                      <td className="mono" style={{ color: '#888' }}>#{inv.number}</td>
                      <td style={{ fontWeight: 500 }}>{inv.counterparty_name || '—'}</td>
                      <td style={{ fontWeight: 600 }}>{inv.amount_display}</td>
                      <td style={{ color: inv.remaining_kopecks > 0 ? '#633806' : '#085041', fontWeight: 500 }}>
                        {inv.remaining_display}
                      </td>
                      <td style={{ color: '#888', fontSize: 12 }}>{inv.due_date ?? '—'}</td>
                      <td>
                        <span className={`status-badge status-${inv.status}`}>
                          {STATUS_ICON[inv.status]} {STATUS_LABEL[inv.status] ?? inv.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
