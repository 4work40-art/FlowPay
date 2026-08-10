'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, formatQty } from '@/lib/api';

// Печатная форма "Счёт на оплату" — стандартный для РФ вид (унифицированной
// формы законом не установлено, но структура общепринята: реквизиты
// продавца с банком, реквизиты покупателя, таблица позиций, НДС "в том
// числе", сумма прописью, подписи). "Печать / Сохранить как PDF" — тот же
// приём, что и у /invoices/[id]/receipt: браузерная печать в PDF, без
// серверной генерации файла.
export default function OutgoingInvoicePrintPage() {
  const { id } = useParams<{ id: string }>();
  const [inv, setInv] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.outgoingInvoices.get(id).then(res => setInv(res.data)).catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) return <div style={{ padding: 40 }}>{error}</div>;
  if (!inv) return null;

  const items = inv.items ?? [];

  return (
    <div style={{ maxWidth: 760, margin: '40px auto', padding: 32, fontFamily: 'sans-serif', color: '#111', fontSize: 13 }}>
      <style>{`@media print { .no-print { display: none; } body { background: #fff; } }`}</style>

      <div className="no-print" style={{ marginBottom: 24, textAlign: 'right' }}>
        <button onClick={() => window.print()} className="btn btn-primary">🖨 Печать / сохранить как PDF</button>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 12 }}>
        <tbody>
          <tr>
            <td style={{ border: '1px solid #000', padding: 4, width: '55%' }}>{inv.org_bank_name || '—'}</td>
            <td style={{ border: '1px solid #000', padding: 4 }}>БИК</td>
            <td style={{ border: '1px solid #000', padding: 4 }}>{inv.org_bank_bik || '—'}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #000', padding: 4 }} rowSpan={2}>Банк получателя</td>
            <td style={{ border: '1px solid #000', padding: 4 }}>Сч. №</td>
            <td style={{ border: '1px solid #000', padding: 4 }}>{inv.org_bank_corr_account || '—'}</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #000', padding: 4 }}>ИНН {inv.org_inn || '—'}{inv.org_kpp ? ` КПП ${inv.org_kpp}` : ''}</td>
            <td style={{ border: '1px solid #000', padding: 4 }} rowSpan={2}>Сч. №</td>
          </tr>
          <tr>
            <td style={{ border: '1px solid #000', padding: 4 }} colSpan={2}>{inv.org_name}</td>
          </tr>
        </tbody>
      </table>
      {inv.org_bank_account && (
        <div style={{ fontSize: 11, marginBottom: 20 }}>Расчётный счёт получателя: {inv.org_bank_account}</div>
      )}

      <h1 style={{ fontSize: 18, textAlign: 'center', margin: '20px 0' }}>
        Счёт на оплату № {inv.number} от {new Date(inv.issue_date).toLocaleDateString('ru-RU')}
      </h1>

      <div style={{ marginBottom: 6 }}>
        <b>Поставщик:</b> {inv.org_name}, ИНН {inv.org_inn || '—'}{inv.org_kpp ? `, КПП ${inv.org_kpp}` : ''}{inv.org_address ? `, ${inv.org_address}` : ''}
      </div>
      <div style={{ marginBottom: 6 }}>
        <b>Покупатель:</b> {inv.counterparty_name || '—'}{inv.counterparty_inn ? `, ИНН ${inv.counterparty_inn}` : ''}{inv.counterparty_kpp ? `, КПП ${inv.counterparty_kpp}` : ''}
        {inv.counterparty_address ? `, ${inv.counterparty_address}` : ''}
      </div>
      {inv.basis && <div style={{ marginBottom: 16 }}><b>Основание:</b> {inv.basis}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 16 }}>
        <thead>
          <tr>
            <th style={{ border: '1px solid #000', padding: 5, textAlign: 'center', width: 30 }}>№</th>
            <th style={{ border: '1px solid #000', padding: 5, textAlign: 'left' }}>Товары (работы, услуги)</th>
            <th style={{ border: '1px solid #000', padding: 5, width: 60 }}>Кол-во</th>
            <th style={{ border: '1px solid #000', padding: 5, width: 50 }}>Ед.</th>
            <th style={{ border: '1px solid #000', padding: 5, width: 90 }}>Цена</th>
            <th style={{ border: '1px solid #000', padding: 5, width: 100 }}>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it: any, i: number) => (
            <tr key={it.id}>
              <td style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>{i + 1}</td>
              <td style={{ border: '1px solid #000', padding: 5 }}>{it.name}</td>
              <td style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>{formatQty(it.quantity)}</td>
              <td style={{ border: '1px solid #000', padding: 5, textAlign: 'center' }}>{it.unit ?? '—'}</td>
              <td style={{ border: '1px solid #000', padding: 5, textAlign: 'right' }}>{it.unit_price_display}</td>
              <td style={{ border: '1px solid #000', padding: 5, textAlign: 'right' }}>{it.amount_display}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', marginTop: 8, fontSize: 13 }}>
        <div style={{ fontWeight: 700 }}>Итого: {inv.amount_display}</div>
        <div>{inv.vat_mode === 'rate' ? `В том числе НДС ${Number(inv.vat_rate)}%: ${inv.vat_display}` : 'Без НДС'}</div>
      </div>

      <div style={{ marginTop: 16, fontSize: 13 }}>
        Всего наименований {items.length}, на сумму {inv.amount_display}.
      </div>
      <div style={{ marginTop: 4, fontWeight: 700, fontSize: 13 }}>
        Всего к оплате: {inv.amount_in_words}.
      </div>

      <div style={{ marginTop: 48, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span>Руководитель</span>
          <span style={{ flex: 1, borderBottom: '1px solid #000', minWidth: 180 }} />
          <span style={{ minWidth: 160, textAlign: 'center' }}>{inv.org_director_name || ''}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <span>Бухгалтер</span>
          <span style={{ flex: 1, borderBottom: '1px solid #000', minWidth: 180 }} />
          <span style={{ minWidth: 160, textAlign: 'center' }}>{inv.org_accountant_name || ''}</span>
        </div>
        <div className="text-muted" style={{ fontSize: 11, color: '#888' }}>М.П.</div>
      </div>

      <div style={{ marginTop: 40, fontSize: 11, color: '#999' }}>
        Документ сформирован автоматически в Счёт&amp;Контроль. Внимание: не является счётом-фактурой и не заменяет
        документы строгой отчётности.
      </div>
    </div>
  );
}
