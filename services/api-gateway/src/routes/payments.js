const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const from   = req.query.from; // YYYY-MM-DD, по payment_date
  const to     = req.query.to;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;
  try {
    const params = [orgId];
    let where = 'WHERE p.org_id = $1';
    if (from) { params.push(from); where += ` AND p.payment_date >= $${params.length}`; }
    if (to)   { params.push(to);   where += ` AND p.payment_date <= $${params.length}`; }

    const { rows } = await pool.query(`
      SELECT p.*, i.number AS invoice_number, c.name AS counterparty_name
      FROM payments p
      JOIN invoices i ON p.invoice_id = i.id
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      ${where} ORDER BY p.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);
    const cnt = await pool.query(`SELECT COUNT(*) FROM payments p ${where}`, params);
    return ok(res, {
      items: rows.map(r => ({ ...r, amount_display: fmt(r.amount_kopecks) })),
      total: +cnt.rows[0].count, page, limit,
    });
  } catch (e) {
    return dbErr(res, e, '[payments list]');
  }
});

const PAYMENT_BLOCKED_STATUSES = ['DISPUTED', 'ARCHIVED', 'WRITTEN_OFF'];

// Платёжное поручение имеет собственный номер, выданный банком/1С — если в
// пределах одной организации уже есть платёж по ЭТОМУ ЖЕ счёту с тем же
// номером платёжки, датой и суммой, это почти наверняка повторная загрузка
// того же документа, а не два разных платежа. Проверяем только когда указан
// номер (reference) — иначе легитимные платежи без референса на одну и ту
// же круглую сумму в один день ложно считались бы дублями.
async function findDuplicatePayment(client, orgId, invoiceId, reference, paymentDate, amountKopecks) {
  if (!reference || !String(reference).trim()) return null;
  const { rows } = await client.query(
    `SELECT id, invoice_id, payment_date, amount_kopecks FROM payments
     WHERE org_id=$1 AND invoice_id=$2 AND reference=$3 AND payment_date=$4 AND amount_kopecks=$5
     LIMIT 1`,
    [orgId, invoiceId, String(reference).trim(), paymentDate, amountKopecks]
  );
  return rows[0] || null;
}

router.post('/', authMiddleware, async (req, res) => {
  const { invoice_id, amount_kopecks, method, reference, payment_date, force } = req.body || {};
  if (!invoice_id)      return err(res, 400, 'Не указан ID счёта', 'VALIDATION_ERROR');
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'Сумма должна быть целым числом', 'VALIDATION_ERROR');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FOR UPDATE — блокируем строку счёта на время транзакции, чтобы два
    // одновременных платежа не читали один и тот же устаревший paid_kopecks.
    const invRows = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [invoice_id]);
    if (!invRows.rows.length || invRows.rows[0].org_id !== req.user.org_id) {
      await client.query('ROLLBACK');
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    }
    const inv = invRows.rows[0];

    const effectiveDate = payment_date || new Date().toISOString().slice(0, 10);
    if (!force) {
      const dup = await findDuplicatePayment(client, req.user.org_id, invoice_id, reference, effectiveDate, amount_kopecks);
      if (dup) {
        await client.query('ROLLBACK');
        const dupDateStr = dup.payment_date instanceof Date ? dup.payment_date.toISOString().slice(0, 10) : dup.payment_date;
        return err(res, 409,
          `Платёж с таким же номером, датой и суммой по этому счёту уже зафиксирован (${dupDateStr}). Если это действительно другой платёж — подтвердите повторно.`,
          'DUPLICATE_PAYMENT');
      }
    }
    // pg возвращает BIGINT-колонки строками — без явного приведения
    // `inv.paid_kopecks + amount_kopecks` превращается в конкатенацию строк,
    // а не сложение чисел.
    inv.amount_kopecks = Number(inv.amount_kopecks);
    inv.paid_kopecks   = Number(inv.paid_kopecks);

    if (PAYMENT_BLOCKED_STATUSES.includes(inv.status)) {
      await client.query('ROLLBACK');
      return err(res, 400, `Счёт в статусе ${inv.status} не принимает платежи`, 'INVOICE_STATE_INVALID');
    }

    const remaining = inv.amount_kopecks - inv.paid_kopecks;
    if (amount_kopecks > remaining) {
      await client.query('ROLLBACK');
      return err(res, 400, `Сумма превышает остаток к оплате. Максимум: ${(remaining / 100).toFixed(2)} ₽`, 'PAYMENT_VALIDATION_ERROR');
    }

    const { rows } = await client.query(`
      INSERT INTO payments(invoice_id, org_id, amount_kopecks, method, reference, payment_date, created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [invoice_id, inv.org_id, amount_kopecks,
        method || 'bank_transfer', reference || null,
        effectiveDate, req.user.id]);

    const newPaid   = inv.paid_kopecks + amount_kopecks;
    const newStatus = newPaid >= inv.amount_kopecks ? 'PAID' : 'PARTIALLY_PAID';

    await client.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [newPaid, newStatus, invoice_id]);

    await client.query('COMMIT');

    await audit(inv.org_id, req.user.id, 'payment.created', 'payment', rows[0].id,
      { paid_kopecks: inv.paid_kopecks, status: inv.status },
      { paid_kopecks: newPaid, status: newStatus, duplicate_check_overridden: !!force });

    return ok(res, {
      payment_id:        rows[0].id,
      invoice_id,
      amount_display:    fmt(amount_kopecks),
      remaining_display: fmt(inv.amount_kopecks - newPaid),
      invoice_status:    newStatus,
      status:            'confirmed',
    }, 201);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[payment create]');
  } finally {
    client.release();
  }
});

const NON_DELETABLE_STATUSES = ['ARCHIVED', 'WRITTEN_OFF'];

// Удаление ошибочно занесённого платежа (например, автоматическое
// разнесение выписки привязало не тот платёж к счёту). Пересчитываем
// paid_kopecks и статус счёта так, как будто этого платежа никогда не было.
router.delete('/:id', authMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const payRows = await client.query('SELECT * FROM payments WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!payRows.rows.length) {
      await client.query('ROLLBACK');
      return err(res, 404, 'Платёж не найден', 'NOT_FOUND');
    }
    const payment = payRows.rows[0];

    const invRows = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [payment.invoice_id]);
    const inv = invRows.rows[0];
    if (!inv) {
      await client.query('ROLLBACK');
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    }
    if (NON_DELETABLE_STATUSES.includes(inv.status)) {
      await client.query('ROLLBACK');
      return err(res, 400, `Счёт в статусе ${inv.status} — платежи по нему изменить нельзя`, 'INVOICE_STATE_INVALID');
    }

    await client.query('DELETE FROM payments WHERE id=$1', [payment.id]);

    const amountKopecks = Number(payment.amount_kopecks);
    const amountTotal   = Number(inv.amount_kopecks);
    const newPaid = Math.max(0, Number(inv.paid_kopecks) - amountKopecks);
    // Статус счёта без этого платежа: если что-то ещё оплачено — частичная
    // оплата; если ничего — счёт возвращается «в работу», просроченным,
    // если срок оплаты уже прошёл (та же граница, что и у overdueJob).
    const newStatus = newPaid > 0
      ? 'PARTIALLY_PAID'
      : (inv.due_date && new Date(inv.due_date) < new Date() ? 'OVERDUE' : 'UNDER_CONTROL');

    await client.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [newPaid, newStatus, inv.id]);

    await client.query('COMMIT');

    await audit(req.user.org_id, req.user.id, 'payment.deleted', 'payment', payment.id,
      { amount_kopecks: amountKopecks, invoice_id: inv.id },
      { invoice_paid_kopecks: newPaid, invoice_status: newStatus });

    return ok(res, { deleted: true, invoice_id: inv.id, invoice_status: newStatus, remaining_display: fmt(amountTotal - newPaid) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return dbErr(res, e, '[payment delete]');
  } finally {
    client.release();
  }
});

module.exports = router;
