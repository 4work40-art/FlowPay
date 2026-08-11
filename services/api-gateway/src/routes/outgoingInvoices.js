// Выставленные счета — счета, которые организация выставляет своим клиентам
// (продавец — сама организация, покупатель — контрагент). Противоположное
// направление денег по сравнению с /invoices (счета от поставщиков, которые
// организация оплачивает). Форма — стандартный для РФ "Счёт на оплату":
// реквизиты продавца/покупателя, таблица позиций, НДС "в том числе",
// сумма прописью — печатается на фронтенде, здесь только данные и расчёт.
const express = require('express');
const ExcelJS = require('exceljs');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');
const { calcAmountKopecks, calcTotals } = require('../lib/outgoingInvoiceCalc');
const { amountToWordsRu } = require('../lib/numberToWordsRu');

const router = express.Router();

const VAT_RATES = new Set([0, 5, 7, 10, 20, 22]); // актуальные ставки НДС в РФ (22% — с 2026 года)
const EDITABLE_STATUSES = new Set(['draft']);
const STATUS_TRANSITIONS = {
  send: { from: ['draft'], to: 'sent' },
  mark_paid: { from: ['sent', 'overdue'], to: 'paid' },
  mark_overdue: { from: ['sent'], to: 'overdue' },
  cancel: { from: ['draft', 'sent', 'overdue'], to: 'cancelled' },
  reopen: { from: ['cancelled'], to: 'draft' },
};

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) return 'Добавьте хотя бы одну позицию';
  for (const it of items) {
    if (!it || typeof it.name !== 'string' || !it.name.trim())
      return 'У каждой позиции должно быть название';
    if (!Number.isFinite(Number(it.quantity)) || Number(it.quantity) <= 0)
      return `Некорректное количество у позиции «${it.name}»`;
    if (!Number.isInteger(it.unit_price_kopecks) || it.unit_price_kopecks <= 0)
      return `Некорректная цена у позиции «${it.name}»`;
  }
  return null;
}

function validateVat(vat_mode, vat_rate) {
  if (vat_mode !== undefined && !['none', 'rate'].includes(vat_mode))
    return 'Некорректный режим НДС';
  if (vat_mode === 'rate' && !VAT_RATES.has(Number(vat_rate)))
    return 'Некорректная ставка НДС';
  return null;
}

async function insertItems(client, orgId, invoiceId, items) {
  let position = 1;
  for (const it of items) {
    const quantity = Number(it.quantity);
    const amount = calcAmountKopecks(quantity, it.unit_price_kopecks);
    await client.query(
      `INSERT INTO outgoing_invoice_items(org_id, outgoing_invoice_id, position, name, quantity, unit, unit_price_kopecks, amount_kopecks)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orgId, invoiceId, position++, it.name.trim(), quantity, it.unit || null, it.unit_price_kopecks, amount]
    );
  }
}

async function recalcTotals(client, orgId, invoiceId) {
  const { rows } = await client.query(
    'SELECT quantity, unit_price_kopecks FROM outgoing_invoice_items WHERE outgoing_invoice_id=$1', [invoiceId]
  );
  const invRows = await client.query('SELECT vat_mode, vat_rate FROM outgoing_invoices WHERE id=$1', [invoiceId]);
  const { vat_mode, vat_rate } = invRows.rows[0];
  const { amount_kopecks, vat_kopecks } = calcTotals(
    rows.map(r => ({ quantity: Number(r.quantity), unit_price_kopecks: Number(r.unit_price_kopecks) })),
    vat_mode, Number(vat_rate)
  );
  await client.query('UPDATE outgoing_invoices SET amount_kopecks=$1, vat_kopecks=$2, updated_at=NOW() WHERE id=$3',
    [amount_kopecks, vat_kopecks, invoiceId]);
  return { amount_kopecks, vat_kopecks };
}

function decorate(row) {
  return {
    ...row,
    amount_display: fmt(row.amount_kopecks),
    vat_display: fmt(row.vat_kopecks),
  };
}

router.get('/', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  const { status, counterparty_id } = req.query;
  const q = req.query.q ? String(req.query.q).trim() : null; // поиск по номеру счёта/названию контрагента (глобальный поиск ⌘K)
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  try {
    const params = [orgId];
    let where = 'WHERE oi.org_id = $1';
    if (status) { params.push(status); where += ` AND oi.status = $${params.length}`; }
    if (counterparty_id) { params.push(counterparty_id); where += ` AND oi.counterparty_id = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (oi.number ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }

    const { rows } = await pool.query(`
      SELECT oi.*, c.name AS counterparty_name
      FROM outgoing_invoices oi
      LEFT JOIN counterparties c ON oi.counterparty_id = c.id
      ${where}
      ORDER BY oi.issue_date DESC, oi.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);
    const cnt = await pool.query(`SELECT COUNT(*) FROM outgoing_invoices oi LEFT JOIN counterparties c ON oi.counterparty_id = c.id ${where}`, params);

    return ok(res, { items: rows.map(decorate), total: +cnt.rows[0].count, page, limit });
  } catch (e) {
    return dbErr(res, e, '[outgoing invoices list]');
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT oi.*, c.name AS counterparty_name, c.inn AS counterparty_inn, c.kpp AS counterparty_kpp,
        c.address AS counterparty_address,
        o.name AS org_name, o.inn AS org_inn, o.kpp AS org_kpp, o.address AS org_address,
        o.bank_account AS org_bank_account, o.bank_name AS org_bank_name,
        o.bank_bik AS org_bank_bik, o.bank_corr_account AS org_bank_corr_account,
        o.director_name AS org_director_name, o.accountant_name AS org_accountant_name
      FROM outgoing_invoices oi
      LEFT JOIN counterparties c ON oi.counterparty_id = c.id
      JOIN organizations o ON oi.org_id = o.id
      WHERE oi.id = $1 AND oi.org_id = $2
    `, [req.params.id, req.user.org_id]);
    if (!rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');

    const items = await pool.query(
      'SELECT * FROM outgoing_invoice_items WHERE outgoing_invoice_id=$1 ORDER BY position', [req.params.id]
    );

    const inv = decorate(rows[0]);
    return ok(res, {
      ...inv,
      amount_in_words: amountToWordsRu(inv.amount_kopecks),
      items: items.rows.map(it => ({
        ...it,
        unit_price_display: fmt(it.unit_price_kopecks),
        amount_display: fmt(it.amount_kopecks),
      })),
    });
  } catch (e) {
    return dbErr(res, e, '[outgoing invoice get]');
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { number, counterparty_id, issue_date, due_date, basis, notes, vat_mode, vat_rate, items } = req.body || {};
  const itemsError = validateItems(items);
  if (itemsError) return err(res, 400, itemsError, 'VALIDATION_ERROR');
  const vatError = validateVat(vat_mode, vat_rate);
  if (vatError) return err(res, 400, vatError, 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    const orgId = req.user.org_id;

    if (counterparty_id) {
      const cp = await client.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [counterparty_id, orgId]);
      if (!cp.rows.length) return err(res, 400, 'Контрагент не найден в вашей организации', 'VALIDATION_ERROR');
    }

    await client.query('BEGIN');

    let finalNumber = number || null;
    if (!finalNumber) {
      const seqRows = await client.query(
        'UPDATE organizations SET next_outgoing_invoice_seq = next_outgoing_invoice_seq + 1 WHERE id=$1 RETURNING next_outgoing_invoice_seq - 1 AS seq',
        [orgId]
      );
      finalNumber = String(seqRows.rows[0].seq);
    } else {
      const dup = await client.query('SELECT id FROM outgoing_invoices WHERE org_id=$1 AND number=$2', [orgId, finalNumber]);
      if (dup.rows.length) {
        await client.query('ROLLBACK');
        return err(res, 409, `Счёт №${finalNumber} уже есть — укажите другой номер`, 'ALREADY_EXISTS');
      }
    }

    const { rows } = await client.query(`
      INSERT INTO outgoing_invoices(org_id, counterparty_id, number, issue_date, due_date, basis, notes, vat_mode, vat_rate, created_by)
      VALUES($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7,COALESCE($8,'none'),COALESCE($9,0),$10)
      RETURNING id
    `, [orgId, counterparty_id || null, finalNumber, issue_date || null, due_date || null,
        basis || null, notes || null, vat_mode || null, vat_rate ?? null, req.user.id]);

    const invoiceId = rows[0].id;
    await insertItems(client, orgId, invoiceId, items);
    const totals = await recalcTotals(client, orgId, invoiceId);

    await client.query('COMMIT');

    await audit(orgId, req.user.id, 'outgoing_invoice.created', 'outgoing_invoice', invoiceId,
      null, { number: finalNumber, amount_kopecks: totals.amount_kopecks });

    return ok(res, { id: invoiceId, number: finalNumber, ...totals }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[outgoing invoice create]');
  } finally {
    client.release();
  }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  const { counterparty_id, issue_date, due_date, basis, notes, vat_mode, vat_rate } = req.body || {};
  const vatError = validateVat(vat_mode, vat_rate);
  if (vatError) return err(res, 400, vatError, 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    const orgId = req.user.org_id;
    const existing = await client.query('SELECT * FROM outgoing_invoices WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!existing.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    if (!EDITABLE_STATUSES.has(existing.rows[0].status))
      return err(res, 400, 'Редактировать можно только черновик — отправленный счёт нельзя менять задним числом', 'INVALID_STATE');

    if (counterparty_id) {
      const cp = await client.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [counterparty_id, orgId]);
      if (!cp.rows.length) return err(res, 400, 'Контрагент не найден в вашей организации', 'VALIDATION_ERROR');
    }

    await client.query('BEGIN');
    const { rows } = await client.query(`
      UPDATE outgoing_invoices SET
        counterparty_id = COALESCE($1, counterparty_id),
        issue_date = COALESCE($2, issue_date),
        due_date = $3,
        basis = $4,
        notes = $5,
        vat_mode = COALESCE($6, vat_mode),
        vat_rate = COALESCE($7, vat_rate),
        updated_at = NOW()
      WHERE id=$8 RETURNING *
    `, [counterparty_id || null, issue_date || null, due_date || null, basis || null, notes || null,
        vat_mode || null, vat_rate ?? null, req.params.id]);

    const totals = await recalcTotals(client, orgId, req.params.id); // ставка НДС могла измениться
    await client.query('COMMIT');

    await audit(orgId, req.user.id, 'outgoing_invoice.updated', 'outgoing_invoice', req.params.id, existing.rows[0], rows[0]);
    return ok(res, decorate({ ...rows[0], ...totals }));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[outgoing invoice update]');
  } finally {
    client.release();
  }
});

router.post('/:id/items', authMiddleware, async (req, res) => {
  const { name, quantity, unit, unit_price_kopecks } = req.body || {};
  const itemsError = validateItems([{ name, quantity, unit, unit_price_kopecks }]);
  if (itemsError) return err(res, 400, itemsError, 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    const orgId = req.user.org_id;
    const inv = await client.query('SELECT status FROM outgoing_invoices WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!inv.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    if (!EDITABLE_STATUSES.has(inv.rows[0].status))
      return err(res, 400, 'Позиции можно менять только в черновике', 'INVALID_STATE');

    await client.query('BEGIN');
    const posRows = await client.query('SELECT COALESCE(MAX(position),0)+1 AS pos FROM outgoing_invoice_items WHERE outgoing_invoice_id=$1', [req.params.id]);
    const amount = calcAmountKopecks(Number(quantity), unit_price_kopecks);
    const { rows } = await client.query(`
      INSERT INTO outgoing_invoice_items(org_id, outgoing_invoice_id, position, name, quantity, unit, unit_price_kopecks, amount_kopecks)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [orgId, req.params.id, posRows.rows[0].pos, name.trim(), Number(quantity), unit || null, unit_price_kopecks, amount]);
    const totals = await recalcTotals(client, orgId, req.params.id);
    await client.query('COMMIT');

    await audit(orgId, req.user.id, 'outgoing_invoice_item.created', 'outgoing_invoice_item', rows[0].id, null, { outgoing_invoice_id: req.params.id, name });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks), unit_price_display: fmt(rows[0].unit_price_kopecks), totals }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[outgoing invoice item create]');
  } finally {
    client.release();
  }
});

router.delete('/:id/items/:itemId', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const orgId = req.user.org_id;
    const inv = await client.query('SELECT status FROM outgoing_invoices WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!inv.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    if (!EDITABLE_STATUSES.has(inv.rows[0].status))
      return err(res, 400, 'Позиции можно менять только в черновике', 'INVALID_STATE');

    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM outgoing_invoice_items WHERE id=$1 AND outgoing_invoice_id=$2 AND org_id=$3 RETURNING id',
      [req.params.itemId, req.params.id, orgId]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return err(res, 404, 'Позиция не найдена', 'NOT_FOUND');
    }
    const remaining = await client.query('SELECT COUNT(*) FROM outgoing_invoice_items WHERE outgoing_invoice_id=$1', [req.params.id]);
    if (+remaining.rows[0].count === 0) {
      await client.query('ROLLBACK');
      return err(res, 400, 'В счёте должна остаться хотя бы одна позиция', 'VALIDATION_ERROR');
    }
    const totals = await recalcTotals(client, orgId, req.params.id);
    await client.query('COMMIT');

    await audit(orgId, req.user.id, 'outgoing_invoice_item.deleted', 'outgoing_invoice_item', req.params.itemId, null, { outgoing_invoice_id: req.params.id });
    return ok(res, { deleted: true, totals });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[outgoing invoice item delete]');
  } finally {
    client.release();
  }
});

// Контроль по выставленным счетам: черновик -> отправлен -> оплачен/просрочен,
// с возможностью отмены и отзыва отмены. Явные переходы (а не свободный статус)
// исключают несогласованные состояния.
router.patch('/:id/status', authMiddleware, async (req, res) => {
  const { transition } = req.body || {};
  const rule = STATUS_TRANSITIONS[transition];
  if (!rule) return err(res, 400, 'Неизвестный переход статуса', 'VALIDATION_ERROR');

  try {
    const orgId = req.user.org_id;
    const existing = await pool.query('SELECT * FROM outgoing_invoices WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!existing.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    if (!rule.from.includes(existing.rows[0].status))
      return err(res, 400, `Нельзя перейти в статус «${rule.to}» из текущего статуса`, 'INVALID_STATE');

    const { rows } = await pool.query(
      'UPDATE outgoing_invoices SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
      [rule.to, req.params.id]
    );
    await audit(orgId, req.user.id, 'outgoing_invoice.status_changed', 'outgoing_invoice', req.params.id,
      { status: existing.rows[0].status }, { status: rule.to });
    return ok(res, decorate(rows[0]));
  } catch (e) {
    return dbErr(res, e, '[outgoing invoice status]');
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const orgId = req.user.org_id;
    const existing = await pool.query('SELECT status FROM outgoing_invoices WHERE id=$1 AND org_id=$2', [req.params.id, orgId]);
    if (!existing.rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    if (!EDITABLE_STATUSES.has(existing.rows[0].status))
      return err(res, 400, 'Удалить можно только черновик — отправленный счёт отмените вместо удаления', 'INVALID_STATE');

    await pool.query('DELETE FROM outgoing_invoices WHERE id=$1', [req.params.id]);
    await audit(orgId, req.user.id, 'outgoing_invoice.deleted', 'outgoing_invoice', req.params.id, null, null);
    return ok(res, { deleted: true });
  } catch (e) {
    return dbErr(res, e, '[outgoing invoice delete]');
  }
});

// Экспорт в Excel — та же печатная форма "Счёт на оплату", что и на
// фронтенде (см. /outgoing-invoices/:id/print), но в редактируемой таблице.
router.get('/:id/export.xlsx', authMiddleware, async (req, res) => {
  try {
    const orgId = req.user.org_id;
    const { rows } = await pool.query(`
      SELECT oi.*, c.name AS counterparty_name, c.inn AS counterparty_inn, c.kpp AS counterparty_kpp,
        c.address AS counterparty_address,
        o.name AS org_name, o.inn AS org_inn, o.kpp AS org_kpp, o.address AS org_address,
        o.bank_account AS org_bank_account, o.bank_name AS org_bank_name,
        o.bank_bik AS org_bank_bik, o.bank_corr_account AS org_bank_corr_account,
        o.director_name AS org_director_name, o.accountant_name AS org_accountant_name
      FROM outgoing_invoices oi
      LEFT JOIN counterparties c ON oi.counterparty_id = c.id
      JOIN organizations o ON oi.org_id = o.id
      WHERE oi.id = $1 AND oi.org_id = $2
    `, [req.params.id, orgId]);
    if (!rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    const inv = rows[0];

    const items = await pool.query(
      'SELECT * FROM outgoing_invoice_items WHERE outgoing_invoice_id=$1 ORDER BY position', [req.params.id]
    );

    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Счёт');
    sheet.columns = [{ width: 6 }, { width: 40 }, { width: 10 }, { width: 8 }, { width: 14 }, { width: 16 }];

    const bold = { font: { bold: true } };
    sheet.addRow([`Получатель: ${inv.org_name}, ИНН ${inv.org_inn || '—'}${inv.org_kpp ? ', КПП ' + inv.org_kpp : ''}`]);
    if (inv.org_bank_account) {
      sheet.addRow([`Банк: ${inv.org_bank_name || '—'}, БИК ${inv.org_bank_bik || '—'}, р/с ${inv.org_bank_account}, к/с ${inv.org_bank_corr_account || '—'}`]);
    }
    sheet.addRow([]);
    const titleRow = sheet.addRow([`Счёт на оплату № ${inv.number} от ${new Date(inv.issue_date).toLocaleDateString('ru-RU')}`]);
    titleRow.font = { bold: true, size: 14 };
    sheet.addRow([`Поставщик: ${inv.org_name}, ИНН ${inv.org_inn || '—'}${inv.org_kpp ? ', КПП ' + inv.org_kpp : ''}${inv.org_address ? ', ' + inv.org_address : ''}`]);
    sheet.addRow([`Покупатель: ${inv.counterparty_name || '—'}${inv.counterparty_inn ? ', ИНН ' + inv.counterparty_inn : ''}${inv.counterparty_kpp ? ', КПП ' + inv.counterparty_kpp : ''}`]);
    if (inv.basis) sheet.addRow([`Основание: ${inv.basis}`]);
    sheet.addRow([]);

    const headerRow = sheet.addRow(['№', 'Наименование товара/услуги', 'Кол-во', 'Ед.', 'Цена', 'Сумма']);
    headerRow.eachCell(c => { c.font = bold; c.border = { bottom: { style: 'thin' } }; });
    items.rows.forEach((it, i) => {
      sheet.addRow([i + 1, it.name, Number(it.quantity), it.unit || '', fmt(it.unit_price_kopecks), fmt(it.amount_kopecks)]);
    });

    sheet.addRow([]);
    const totalRow = sheet.addRow(['', '', '', '', 'Итого:', fmt(inv.amount_kopecks)]);
    totalRow.font = bold;
    if (inv.vat_mode === 'rate') {
      sheet.addRow(['', '', '', '', `В т.ч. НДС ${Number(inv.vat_rate)}%:`, fmt(inv.vat_kopecks)]);
    } else {
      sheet.addRow(['', '', '', '', 'НДС:', 'Без НДС']);
    }
    sheet.addRow([]);
    sheet.addRow([`Всего к оплате: ${amountToWordsRu(inv.amount_kopecks)}`]).font = bold;
    sheet.addRow([]);
    sheet.addRow(['Руководитель ____________________', '', '', inv.org_director_name || '']);
    sheet.addRow(['Бухгалтер ____________________', '', '', inv.org_accountant_name || '']);

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="schet-${inv.number}.xlsx"`);
    return res.send(Buffer.from(buffer));
  } catch (e) {
    return dbErr(res, e, '[outgoing invoice export]');
  }
});

module.exports = router;
