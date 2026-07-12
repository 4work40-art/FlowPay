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

router.post('/', authMiddleware, async (req, res) => {
  const { invoice_id, amount_kopecks, method, reference, payment_date } = req.body || {};
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
        payment_date || new Date().toISOString().slice(0,10), req.user.id]);

    const newPaid   = inv.paid_kopecks + amount_kopecks;
    const newStatus = newPaid >= inv.amount_kopecks ? 'PAID' : 'PARTIALLY_PAID';

    await client.query('UPDATE invoices SET paid_kopecks=$1, status=$2, updated_at=NOW() WHERE id=$3',
      [newPaid, newStatus, invoice_id]);

    await client.query('COMMIT');

    await audit(inv.org_id, req.user.id, 'payment.created', 'payment', rows[0].id,
      { paid_kopecks: inv.paid_kopecks, status: inv.status },
      { paid_kopecks: newPaid, status: newStatus });

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

module.exports = router;
