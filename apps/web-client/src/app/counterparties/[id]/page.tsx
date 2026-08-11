'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Pencil, X, Check } from 'lucide-react';
import {
  api, formatDateOnly,
  STATUS_LABEL, STATUS_DESCRIPTION,
  OUTGOING_STATUS_LABEL, OUTGOING_STATUS_DESCRIPTION,
} from '@/lib/api';
import { innError } from '@/lib/inn';

type Counterparty = {
  id: string; name: string; inn: string | null; kpp: string | null;
  phone: string | null; email: string | null; address: string | null; type: string;
  ogrn: string | null; bank_account: string | null; bank_name: string | null;
  bank_bik: string | null; bank_corr_account: string | null;
  trust_score: number | null;
  invoice_count: string; debt_kopecks: string; debt_display: string; is_active: boolean;
};

// Прогнозный риск просрочки — та же эвристика и тот же эндпоинт, что и в
// раскрывающейся строке списка контрагентов (см. counterparties/page.tsx),
// перенесённые сюда на карточку.
type OverdueRisk = {
  available: boolean; message?: string;
  level?: 'low' | 'medium' | 'high'; level_label?: string;
  sample_size?: number; overdue_count?: number; overdue_share_pct?: number;
  avg_delay_days?: number; trend?: 'improving' | 'worsening' | 'stable' | null;
  explanation?: string;
};

const RISK_CHIP_CLASS: Record<string, string> = { low: 'good', medium: 'warn', high: 'bad' };
const TREND_LABEL: Record<string, string> = { improving: 'улучшается', worsening: 'ухудшается', stable: 'без изменений' };
const TYPE_LABEL: Record<string, string> = { vendor: 'Поставщик', contractor: 'Подрядчик', customer: 'Заказчик' };

function statusTagClass(status: string) {
  if (status === 'OVERDUE' || status === 'DISPUTED') return 'tag tag-accent';
  if (status === 'PAID' || status === 'PARTIALLY_PAID' || status === 'PAYMENT_PENDING') return 'tag tag-outline';
  return 'tag tag-neutral';
}

function outgoingStatusTagClass(status: string) {
  if (status === 'overdue') return 'tag tag-accent';
  if (status === 'paid') return 'tag tag-outline';
  return 'tag tag-neutral';
}

type IncomingInvoiceRow = {
  id: string; number: string | null; status: string; amount_display: string;
  remaining_display: string; due_date: string | null; invoice_date: string | null;
};

type OutgoingInvoiceRow = {
  id: string; number: string; status: string; amount_display: string;
  issue_date: string; due_date: string | null;
};

// Поля карточки, доступные для inline-редактирования — переиспользуем
// существующий PATCH /counterparties/:id (частичное обновление, COALESCE
// на бэкенде: присланные undefined-поля не трогают текущие значения).
const EDIT_FIELDS: { key: keyof Counterparty; label: string }[] = [
  { key: 'name', label: 'Название' },
  { key: 'inn', label: 'ИНН' },
  { key: 'kpp', label: 'КПП' },
  { key: 'phone', label: 'Телефон' },
  { key: 'email', label: 'Email' },
  { key: 'address', label: 'Адрес' },
  { key: 'bank_account', label: 'Расчётный счёт' },
  { key: 'bank_name', label: 'Банк' },
  { key: 'bank_bik', label: 'БИК' },
  { key: 'bank_corr_account', label: 'Корр. счёт' },
  { key: 'ogrn', label: 'ОГРН' },
];

export default function CounterpartyDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [cp, setCp] = useState<Counterparty | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [incoming, setIncoming] = useState<IncomingInvoiceRow[]>([]);
  const [outgoing, setOutgoing] = useState<OutgoingInvoiceRow[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);

  const [risk, setRisk] = useState<OverdueRisk | 'loading' | 'error' | null>(null);

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    api.counterparties.get(id)
      .then(res => setCp(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [id]);

  const loadInvoices = useCallback(() => {
    setInvoicesLoading(true);
    Promise.all([
      api.invoices.list({ counterparty_id: id, limit: '100' }),
      api.outgoingInvoices.list({ counterparty_id: id, limit: '100' }),
    ])
      .then(([inc, out]) => {
        setIncoming(inc.data?.items ?? []);
        setOutgoing(out.data?.items ?? []);
      })
      .catch(() => {})
      .finally(() => setInvoicesLoading(false));
  }, [id]);

  useEffect(() => { load(); loadInvoices(); }, [load, loadInvoices]);

  useEffect(() => {
    setRisk('loading');
    api.counterparties.overdueRisk(id)
      .then(res => setRisk(res.data as OverdueRisk))
      .catch(() => setRisk('error'));
  }, [id]);

  const startEdit = () => {
    if (!cp) return;
    setForm({
      name: cp.name ?? '', inn: cp.inn ?? '', kpp: cp.kpp ?? '',
      phone: cp.phone ?? '', email: cp.email ?? '', address: cp.address ?? '',
      bank_account: cp.bank_account ?? '', bank_name: cp.bank_name ?? '',
      bank_bik: cp.bank_bik ?? '', bank_corr_account: cp.bank_corr_account ?? '',
      ogrn: cp.ogrn ?? '', type: cp.type,
    });
    setFormError('');
    setEditing(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError('Укажите название'); return; }
    const innMsg = innError(form.inn);
    if (innMsg) { setFormError(innMsg); return; }
    setSaving(true);
    try {
      const body: Record<string, any> = { ...form };
      // Пустая строка -> не трогаем поле (COALESCE на бэкенде игнорирует
      // только undefined/null, поэтому явно чистим необязательные пустые поля).
      for (const k of Object.keys(body)) {
        if (body[k] === '' && k !== 'name') body[k] = null;
      }
      await api.counterparties.update(id, body);
      setEditing(false);
      load(true);
    } catch (e: any) {
      setFormError(e.message || 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!cp) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">{cp.name}</div>
          <div className="page-sub">{TYPE_LABEL[cp.type] ?? cp.type} · ИНН {cp.inn ?? '—'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button className="btn btn-secondary btn-sm" onClick={startEdit}>
              <Pencil size={14} strokeWidth={1.5} /> Редактировать
            </button>
          )}
          <a href="/counterparties" className="btn btn-secondary btn-sm"><ArrowLeft size={14} strokeWidth={1.5} /> К списку</a>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Счетов</div>
          <div className="metric-value">{cp.invoice_count}</div>
        </div>
        <div className="metric-card amber blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Текущий долг</div>
          <div className="metric-value">{cp.debt_display}</div>
        </div>
        <div className="metric-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Trust Score</div>
          <div className="metric-value">{cp.trust_score ?? 50}</div>
        </div>
      </div>

      {/* Прогноз риска просрочки — та же эвристика, что и в списке контрагентов,
          здесь всегда развёрнута, т.к. это единственный контрагент на странице. */}
      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Риск просрочки — прогноз</div>
        <div className="card-body">
          {risk === 'loading' && <div className="text-muted">Считаем прогноз риска просрочки…</div>}
          {risk === 'error' && <div className="text-muted">Не удалось загрузить прогноз риска</div>}
          {risk && risk !== 'loading' && risk !== 'error' && !risk.available && (
            <div className="text-muted">{risk.message}</div>
          )}
          {risk && risk !== 'loading' && risk !== 'error' && risk.available && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span className={`health-chip ${RISK_CHIP_CLASS[risk.level!]}`}><i />{risk.level_label}</span>
              <span style={{ fontSize: 13 }}>{risk.explanation}</span>
              {risk.trend && (
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Тренд: {TREND_LABEL[risk.trend]}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Реквизиты и контакты</div>
        {editing ? (
          <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
            <form onSubmit={save}>
              {formError && <div className="error-box">{formError}</div>}
              <div className="form-grid">
                <div className="form-group full">
                  <label className="field-label">Название *</label>
                  <input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Тип</label>
                  <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                    <option value="vendor">Поставщик</option>
                    <option value="contractor">Подрядчик</option>
                    <option value="customer">Заказчик</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="field-label">ИНН</label>
                  <input className="input" inputMode="numeric" maxLength={12} value={form.inn} onChange={e => setForm({ ...form, inn: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">КПП</label>
                  <input className="input" value={form.kpp} onChange={e => setForm({ ...form, kpp: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Телефон</label>
                  <input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Email</label>
                  <input className="input" type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="form-group full">
                  <label className="field-label">Адрес</label>
                  <input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">ОГРН</label>
                  <input className="input" value={form.ogrn} onChange={e => setForm({ ...form, ogrn: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Расчётный счёт</label>
                  <input className="input" value={form.bank_account} onChange={e => setForm({ ...form, bank_account: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Банк</label>
                  <input className="input" value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">БИК</label>
                  <input className="input" value={form.bank_bik} onChange={e => setForm({ ...form, bank_bik: e.target.value })} />
                </div>
                <div className="form-group">
                  <label className="field-label">Корр. счёт</label>
                  <input className="input" value={form.bank_corr_account} onChange={e => setForm({ ...form, bank_corr_account: e.target.value })} />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
                  {saving ? 'Сохраняем…' : <><Check size={14} strokeWidth={1.5} /> Сохранить</>}
                </button>
                <button type="button" className="btn btn-secondary btn-sm" disabled={saving} onClick={() => setEditing(false)}>
                  <X size={14} strokeWidth={1.5} /> Отмена
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
            <div className="form-grid">
              <Field label="Тип" value={TYPE_LABEL[cp.type] ?? cp.type} />
              <Field label="ИНН" value={cp.inn} />
              <Field label="КПП" value={cp.kpp} />
              <Field label="Телефон" value={cp.phone} />
              <Field label="Email" value={cp.email} />
              <Field label="Адрес" value={cp.address} full />
              <Field label="ОГРН" value={cp.ogrn} />
              <Field label="Расчётный счёт" value={cp.bank_account} />
              <Field label="Банк" value={cp.bank_name} />
              <Field label="БИК" value={cp.bank_bik} />
              <Field label="Корр. счёт" value={cp.bank_corr_account} />
            </div>
          </div>
        )}
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">Входящие счета (от поставщика)</div>
        <div className="table-wrap responsive-table">
          <table className="table">
            <thead>
              <tr>
                <th>Номер</th><th>Статус</th><th>Сумма</th><th>Остаток</th><th>Срок оплаты</th>
              </tr>
            </thead>
            <tbody>
              {incoming.map(inv => (
                <tr key={inv.id} onClick={() => { window.location.href = `/invoices/${inv.id}`; }} style={{ cursor: 'pointer' }}>
                  <td data-label="Номер" style={{ fontWeight: 500 }}>№{inv.number ?? '—'}</td>
                  <td data-label="Статус">
                    <span className={statusTagClass(inv.status)} title={STATUS_DESCRIPTION[inv.status] ?? ''}>
                      {STATUS_LABEL[inv.status] ?? inv.status}
                    </span>
                  </td>
                  <td data-label="Сумма">{inv.amount_display}</td>
                  <td data-label="Остаток" className="text-muted">{inv.remaining_display}</td>
                  <td data-label="Срок оплаты" className="text-muted">{formatDateOnly(inv.due_date)}</td>
                </tr>
              ))}
              {!invoicesLoading && !incoming.length && (
                <tr><td colSpan={5} className="empty-state">Входящих счетов с этим контрагентом нет</td></tr>
              )}
              {invoicesLoading && <tr><td colSpan={5} className="empty-state">Загрузка…</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {(cp.type === 'customer' || outgoing.length > 0) && (
        <div className="card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="card-header">Исходящие счета (клиенту)</div>
          <div className="table-wrap responsive-table">
            <table className="table">
              <thead>
                <tr>
                  <th>Номер</th><th>Статус</th><th>Сумма</th><th>Дата</th><th>Срок оплаты</th>
                </tr>
              </thead>
              <tbody>
                {outgoing.map(inv => (
                  <tr key={inv.id} onClick={() => { window.location.href = `/outgoing-invoices/${inv.id}`; }} style={{ cursor: 'pointer' }}>
                    <td data-label="Номер" style={{ fontWeight: 500 }}>№{inv.number}</td>
                    <td data-label="Статус">
                      <span className={outgoingStatusTagClass(inv.status)} title={OUTGOING_STATUS_DESCRIPTION[inv.status] ?? ''}>
                        {OUTGOING_STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td data-label="Сумма">{inv.amount_display}</td>
                    <td data-label="Дата" className="text-muted">{formatDateOnly(inv.issue_date)}</td>
                    <td data-label="Срок оплаты" className="text-muted">{formatDateOnly(inv.due_date)}</td>
                  </tr>
                ))}
                {!invoicesLoading && !outgoing.length && (
                  <tr><td colSpan={5} className="empty-state">Исходящих счетов этому контрагенту нет</td></tr>
                )}
                {invoicesLoading && <tr><td colSpan={5} className="empty-state">Загрузка…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, full }: { label: string; value: string | null; full?: boolean }) {
  return (
    <div className={`form-group${full ? ' full' : ''}`}>
      <label className="field-label">{label}</label>
      <div>{value || '—'}</div>
    </div>
  );
}
