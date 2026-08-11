'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Link2, Ban, Unlock, ArrowLeft, Plus, Download, Trash2, X } from 'lucide-react';
import { api, STATUS_LABEL, STATUS_DESCRIPTION, InvoiceItemInput, formatQty } from '@/lib/api';
import { getStoredUser } from '@/lib/auth';

type Payment = {
  id: string;
  amount_kopecks: number;
  amount_display: string;
  method: string;
  reference: string | null;
  payment_date: string;
  created_at: string;
};

const METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Банковский перевод', cash: 'Наличные', check: 'Чек', online: 'Онлайн-оплата',
};

const TRANSITIONS: Record<string, { label: string; from: string[]; cls: string }> = {
  mark_for_control: { label: 'На контроль',      from: ['CREATED'],                                   cls: 'btn-primary' },
  set_pending:      { label: 'Ожидает оплаты',    from: ['UNDER_CONTROL'],                             cls: 'btn-primary' },
  mark_overdue:     { label: 'Отметить просрочку', from: ['PAYMENT_PENDING', 'UNDER_CONTROL'],          cls: 'btn-secondary'   },
  open_dispute:     { label: 'Открыть спор',       from: ['PAYMENT_PENDING', 'OVERDUE', 'PARTIALLY_PAID'], cls: 'btn-secondary'   },
  resolve_dispute:  { label: 'Закрыть спор',       from: ['DISPUTED'],                                  cls: 'btn-primary' },
  write_off:        { label: 'Списать',            from: ['OVERDUE'],                                   cls: 'btn-secondary'   },
  archive:          { label: 'В архив',           from: ['PAID'],                                      cls: 'btn-secondary'    },
};

// Списание, открытие и закрытие спора — финансово значимые, по сути
// необратимые решения. На бэкенде (PATCH /invoices/:id/state) доступны
// только owner и accountant — здесь просто скрываем кнопки для остальных
// ролей, чтобы не предлагать действие, которое всё равно вернёт 403.
const RESTRICTED_TRANSITIONS = new Set(['write_off', 'open_dispute', 'resolve_dispute']);
const RESTRICTED_TRANSITION_ROLES = new Set(['owner', 'accountant']);
// Требуем причину для списания и открытия спора — без неё решение
// неинформативно для того, кто будет его потом разбирать.
const REASON_REQUIRED_TRANSITIONS = new Set(['write_off', 'open_dispute']);

function statusTagClass(status: string) {
  if (status === 'OVERDUE' || status === 'DISPUTED') return 'tag tag-accent';
  if (status === 'PAID' || status === 'PARTIALLY_PAID' || status === 'PAYMENT_PENDING') return 'tag tag-outline';
  return 'tag tag-neutral';
}

type Doc = { id: string; filename: string; mime_type: string; size_bytes: number; created_at: string };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [inv,     setInv]     = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [acting,  setActing]  = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);

  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docError, setDocError] = useState('');

  // Предложение дозаполнить недостающие поля счёта данными, распознанными
  // из только что прикреплённого файла (та же логика распознавания и тот
  // же эндпоинт /invoices/:id/fill-missing, что использует форма создания
  // счёта для дозаполнения дубля — см. invoices/new/page.tsx). Дозаполняем
  // только то, чего в счёте ещё нет: fill-missing на бэкенде использует
  // COALESCE и не трогает уже заполненные поля.
  const [fillSuggestion, setFillSuggestion] = useState<{
    invoice_date?: string; due_date?: string; items?: InvoiceItemInput[]; fieldsLabel: string;
  } | null>(null);
  const [filling, setFilling] = useState(false);

  // silent=true — обновить данные счёта без полноэкранного спиннера (после
  // локальных изменений вроде удаления платежа/позиции): иначе весь контент
  // страницы на секунду пропадает и ощущается как перезагрузка страницы.
  // Полный спиннер нужен только при первом заходе на страницу.
  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    api.invoices.get(id)
      .then(res => setInv(res.data))
      .catch((e: Error) => setError(e.message))
      .finally(() => { if (!silent) setLoading(false); });
  }, [id]);

  const loadDocs = useCallback(() => {
    api.documents.list(id).then(res => setDocs(res.data?.items ?? [])).catch(() => {});
  }, [id]);

  useEffect(() => { load(); loadDocs(); }, [load, loadDocs]);

  const onFileSelected = async (file: File | null) => {
    if (!file) return;
    setDocError('');
    setFillSuggestion(null);
    setUploading(true);
    try {
      await api.documents.upload(id, file);
      loadDocs();
    } catch (e: any) {
      setDocError(e.message || 'Не удалось загрузить файл');
      setUploading(false);
      return;
    }
    setUploading(false);

    // Файл прикреплён — дополнительно пробуем распознать его тем же
    // эндпоинтом, что и форма создания счёта, и предлагаем дозаполнить
    // только то, чего у счёта ещё нет (дату счёта/срок оплаты/позиции).
    // Ошибка или неудачное распознавание не мешают самому прикреплению —
    // файл уже сохранён, это лишь необязательная подсказка сверху.
    try {
      const res = await api.documents.recognize(file);
      const r = res.data;
      if (r.doc_type !== 'invoice') return;
      const f = r.fields;
      const missing: { invoice_date?: string; due_date?: string; items?: InvoiceItemInput[] } = {};
      const labels: string[] = [];
      if (!inv?.invoice_date && f.invoice_date) { missing.invoice_date = f.invoice_date; labels.push('дату счёта'); }
      if (!inv?.due_date && f.due_date) { missing.due_date = f.due_date; labels.push('срок оплаты'); }
      if (!inv?.items?.length && f.items?.length) {
        missing.items = f.items.map((it: any) => ({ name: it.name, quantity: it.quantity, unit: it.unit || undefined, unit_price_kopecks: it.unit_price_kopecks }));
        labels.push('товарные позиции');
      }
      if (labels.length) setFillSuggestion({ ...missing, fieldsLabel: labels.join(', ') });
    } catch {
      // распознавание необязательно — молча пропускаем
    }
  };

  const applyFillSuggestion = async () => {
    if (!fillSuggestion) return;
    setFilling(true);
    try {
      const { fieldsLabel, ...body } = fillSuggestion;
      await api.invoices.fillMissing(id, body);
      setFillSuggestion(null);
      load(true);
    } catch (e: any) {
      setDocError(e.message || 'Не удалось дозаполнить счёт');
    } finally {
      setFilling(false);
    }
  };

  const doTransition = async (key: string) => {
    let reason: string | undefined;
    if (REASON_REQUIRED_TRANSITIONS.has(key)) {
      const label = TRANSITIONS[key]?.label ?? key;
      const input = window.prompt(`Укажите причину действия «${label}» — это обязательно`);
      if (input === null) return; // отменено пользователем
      if (!input.trim()) { alert('Причина обязательна для этого действия'); return; }
      reason = input.trim();
    }
    setActing(true);
    try {
      await api.invoices.transition(id, key, reason);
      load();
    } catch (e: any) {
      alert('Ошибка: ' + e.message);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="loading">Загрузка…</div>;
  if (error) return <div className="error-box"><strong>Ошибка:</strong> {error}</div>;
  if (!inv) return null;

  const userRole = getStoredUser()?.role;
  const available = Object.entries(TRANSITIONS).filter(([key, t]) =>
    t.from.includes(inv.status) &&
    (!RESTRICTED_TRANSITIONS.has(key) || RESTRICTED_TRANSITION_ROLES.has(userRole ?? ''))
  );

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Счёт №{inv.number ?? '—'}</div>
          <div className="page-sub">{inv.counterparty_name ?? 'без контрагента'}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {inv.public_enabled ? (
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const url = `${window.location.origin}/public/invoice/${id}`;
                  navigator.clipboard?.writeText(url);
                  alert('Ссылка на счёт скопирована — можно отправить контрагенту, регистрация не нужна');
                }}>
                <Link2 size={14} strokeWidth={1.5} /> Поделиться
              </button>
              <button
                className="btn btn-secondary btn-sm"
                title="Публичная ссылка перестанет открываться у контрагента"
                onClick={async () => {
                  try { await api.invoices.setPublic(id, false); setInv({ ...inv, public_enabled: false }); }
                  catch (e: any) { alert(e.message); }
                }}>
                <Ban size={14} strokeWidth={1.5} /> Закрыть доступ
              </button>
            </>
          ) : (
            <button
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                try { await api.invoices.setPublic(id, true); setInv({ ...inv, public_enabled: true }); }
                catch (e: any) { alert(e.message); }
              }}>
              <Unlock size={14} strokeWidth={1.5} /> Открыть доступ по ссылке
            </button>
          )}
          <a href="/invoices" className="btn btn-secondary btn-sm"><ArrowLeft size={14} strokeWidth={1.5} /> К списку</a>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Сумма счёта</div>
          <div className="metric-value">{inv.amount_display}</div>
        </div>
        <div className="metric-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Оплачено</div>
          <div className="metric-value">{inv.paid_display}</div>
        </div>
        <div className="metric-card amber blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Остаток</div>
          <div className="metric-value">{inv.remaining_display}</div>
        </div>
        <div className="metric-card blueprint">
          <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
          <div className="metric-label">Срок оплаты</div>
          <div className="metric-value" style={{ fontSize: 16 }}>{inv.due_date ? new Date(inv.due_date).toLocaleDateString('ru-RU') : '—'}</div>
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          <span className={statusTagClass(inv.status)} title={STATUS_DESCRIPTION[inv.status] ?? ''}>
            {STATUS_LABEL[inv.status] ?? inv.status}
          </span>
          {inv.remaining_kopecks > 0 && !['DISPUTED', 'ARCHIVED', 'WRITTEN_OFF'].includes(inv.status) && (
            <a href={`/payments/new?invoice=${inv.id}`} className="btn btn-primary btn-sm"><Plus size={14} strokeWidth={1.5} /> Платёж</a>
          )}
        </div>
        {inv.notes && <div className="card-body text-muted">{inv.notes}</div>}
        <div className="card-body" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {available.map(([key, t]) => (
            <button key={key} className={`btn btn-sm ${t.cls}`} disabled={acting} onClick={() => doTransition(key)}>
              {t.label}
            </button>
          ))}
          {!available.length && <span className="field-hint">Для этого статуса действий больше нет.</span>}
        </div>
      </div>

      <div className="card blueprint" style={{ marginBottom: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">
          Документы
          <label className="btn btn-sm btn-primary" style={{ cursor: 'pointer' }}>
            {uploading ? 'Загружаем…' : <><Plus size={14} strokeWidth={1.5} /> Прикрепить файл</>}
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              style={{ display: 'none' }}
              disabled={uploading}
              onChange={e => { onFileSelected(e.target.files?.[0] ?? null); e.target.value = ''; }}
            />
          </label>
        </div>
        {docError && <div className="error-box">{docError}</div>}
        {fillSuggestion && (
          <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)', background: 'var(--blue-light, #eaf2fb)', color: 'var(--blue-dark, #1a5fb4)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span>В прикреплённом файле распознали {fillSuggestion.fieldsLabel} — дозаполнить недостающее в счёте?</span>
            <button type="button" className="btn btn-sm btn-primary" disabled={filling} onClick={applyFillSuggestion}>
              {filling ? 'Дозаполняем…' : 'Дозаполнить'}
            </button>
            <button type="button" className="btn btn-sm btn-ghost" disabled={filling} onClick={() => setFillSuggestion(null)}>
              Не сейчас
            </button>
          </div>
        )}
        <div className="table-wrap responsive-table">
          <table className="table">
            <thead>
              <tr>
                <th>Файл</th>
                <th>Размер</th>
                <th>Загружен</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td data-label="Файл" style={{ fontWeight: 500 }}>{d.filename}</td>
                  <td data-label="Размер" className="text-muted">{fmtSize(d.size_bytes)}</td>
                  <td data-label="Загружен" className="text-muted" style={{ fontSize: 12 }}>{new Date(d.created_at).toLocaleString('ru-RU')}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => api.documents.download(d.id, d.filename)}>
                      <Download size={14} strokeWidth={1.5} /> Скачать
                    </button>
                  </td>
                </tr>
              ))}
              {!docs.length && (
                <tr><td colSpan={4} className="empty-state">Файлов пока нет — прикрепите скан или PDF счёта</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
          <span className="field-hint">Разрешены PDF, JPG, PNG, до 15 МБ. Если в файле распознаются недостающие в счёте данные (дата, срок оплаты, позиции) — предложим их дозаполнить.</span>
        </div>
      </div>

      <ItemsCard invoiceId={id} items={inv.items ?? []} onChanged={() => load(true)} />

      <div className="card blueprint" style={{ marginTop: 'var(--space-4)' }}>
        <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
        <div className="card-header">История платежей</div>
        <div className="table-wrap responsive-table">
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Сумма</th>
                <th>Способ</th>
                <th>Референс</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(inv.payments as Payment[] ?? []).map(p => (
                <tr key={p.id}>
                  <td data-label="Дата">{new Date(p.payment_date).toLocaleDateString('ru-RU')}</td>
                  <td data-label="Сумма" style={{ fontWeight: 600 }}>{p.amount_display}</td>
                  <td data-label="Способ">{METHOD_LABEL[p.method] ?? p.method}</td>
                  <td data-label="Референс" className="text-muted">{p.reference ?? '—'}</td>
                  <td style={{ display: 'flex', gap: 6 }}>
                    <a className="btn btn-ghost btn-sm" href={`/invoices/${id}/receipt?payment=${p.id}`} target="_blank" rel="noreferrer">Акт</a>
                    <button
                      type="button" className="btn btn-icon btn-secondary" disabled={deletingPaymentId === p.id}
                      title="Удалить платёж (например, если разнесён по ошибке)"
                      onClick={async () => {
                        if (!confirm(`Удалить платёж на ${p.amount_display} от ${new Date(p.payment_date).toLocaleDateString('ru-RU')}? Сумма и статус счёта будут пересчитаны.`)) return;
                        setDeletingPaymentId(p.id);
                        // Убираем строку сразу, не дожидаясь ответа сервера — ощущается
                        // мгновенно; точные суммы/статус подтянутся тихим обновлением ниже.
                        setInv((prev: any) => prev && { ...prev, payments: prev.payments.filter((x: Payment) => x.id !== p.id) });
                        try {
                          await api.payments.delete(p.id);
                          load(true);
                        } catch (e: any) {
                          alert(e.message || 'Не удалось удалить платёж');
                          load(true); // откатываем оптимистичное удаление, если запрос не прошёл
                        } finally {
                          setDeletingPaymentId(null);
                        }
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
              {!inv.payments?.length && (
                <tr><td colSpan={5} className="empty-state">Платежей ещё не было</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

type InvoiceItem = {
  id: string; name: string; quantity: string; unit: string | null;
  unit_price_kopecks: number; unit_price_display: string; amount_display: string;
};

// Товары/услуги по счёту — основа учёта закупок (количество, цена за
// единицу; дальше по ним считается динамика цены и сезонность на странице
// «Аналитика»). Необязательно — счёт можно вести и одной суммой.
function ItemsCard({ invoiceId, items, onChanged }: { invoiceId: string; items: InvoiceItem[]; onChanged: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const q = Number(quantity.replace(',', '.'));
    const p = Number(price.replace(',', '.'));
    if (!name.trim()) { setError('Укажите название'); return; }
    if (!q || q <= 0) { setError('Укажите количество больше нуля'); return; }
    if (!p || p <= 0) { setError('Укажите цену больше нуля'); return; }

    setSaving(true);
    try {
      await api.invoices.addItem(invoiceId, { name: name.trim(), quantity: q, unit: unit || undefined, unit_price_kopecks: Math.round(p * 100) });
      setName(''); setQuantity('1'); setPrice('');
      setShowForm(false);
      onChanged();
    } catch (e: any) {
      setError(e.message || 'Не удалось добавить позицию');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (itemId: string) => {
    if (!confirm('Удалить позицию?')) return;
    try {
      await api.invoices.deleteItem(invoiceId, itemId);
      onChanged();
    } catch (e: any) {
      alert(e.message || 'Не удалось удалить позицию');
    }
  };

  return (
    <div className="card blueprint">
      <i className="corner tl" /><i className="corner tr" /><i className="corner bl" /><i className="corner br" />
      <div className="card-header">
        <span>Товары/услуги</span>
        <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(s => !s)}>
          {showForm ? <><X size={14} strokeWidth={1.5} /> Отмена</> : <><Plus size={14} strokeWidth={1.5} /> Добавить позицию</>}
        </button>
      </div>

      {showForm && (
        <div className="card-body" style={{ borderTop: '1px solid var(--color-divider)' }}>
          <form onSubmit={add} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 3, minWidth: 160 }} placeholder="Наименование" value={name} onChange={e => setName(e.target.value)} autoFocus />
            <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Кол-во" inputMode="decimal" value={quantity} onChange={e => setQuantity(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 70 }} placeholder="Ед." value={unit} onChange={e => setUnit(e.target.value)} />
            <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Цена, ₽" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} />
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Сохраняем…' : 'Добавить'}</button>
          </form>
          {error && <div className="error-box" style={{ marginTop: 10 }}>{error}</div>}
        </div>
      )}

      <div className="table-wrap responsive-table">
        <table className="table">
          <thead>
            <tr><th>Наименование</th><th>Кол-во</th><th>Ед.</th><th>Цена</th><th>Сумма</th><th></th></tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id}>
                <td data-label="Наименование">{it.name}</td>
                <td data-label="Кол-во">{formatQty(it.quantity)}</td>
                <td data-label="Ед.">{it.unit ?? '—'}</td>
                <td data-label="Цена">{it.unit_price_display}</td>
                <td data-label="Сумма" style={{ fontWeight: 600 }}>{it.amount_display}</td>
                <td><button className="btn btn-icon btn-secondary" onClick={() => remove(it.id)} aria-label={`Удалить позицию «${it.name}»`}><Trash2 size={14} strokeWidth={1.5} /></button></td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={6} className="empty-state">Позиции не добавлены</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
