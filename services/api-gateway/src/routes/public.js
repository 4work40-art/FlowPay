const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { rateLimit } = require('../lib/rateLimit');

const router = express.Router();

// UUID v4 практически не перебираем, но лимит по IP — защита от сканеров/DoS.
const publicInvoiceLimiter = rateLimit({
  keyFn: (req) => `public-invoice:${req.ip}`,
  max: 60, windowSeconds: 60,
  message: 'Слишком много запросов, попробуйте позже',
});

// Публичная ссылка на счёт — без авторизации. invoice.id — непредсказуемый
// UUID v4, сам по себе выполняет роль токена доступа (как у Bill.com/Melio
// customer-facing portal), поэтому отдельная таблица токенов не нужна.
// Отдаём только то, что нужно контрагенту для проверки остатка — без
// внутренних заметок, автора, org_id и прочих деталей кабинета.
router.get('/invoices/:id', publicInvoiceLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.number, i.amount_kopecks, i.paid_kopecks, i.status, i.due_date, i.invoice_date,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks,
        o.name AS org_name
      FROM invoices i
      JOIN organizations o ON o.id = i.org_id
      WHERE i.id = $1
    `, [req.params.id]);

    if (!rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    const inv = rows[0];

    const pmts = await pool.query(
      `SELECT amount_kopecks, method, payment_date FROM payments WHERE invoice_id = $1 ORDER BY payment_date`,
      [req.params.id]
    );

    return ok(res, {
      org_name: inv.org_name,
      number: inv.number,
      status: inv.status,
      invoice_date: inv.invoice_date,
      due_date: inv.due_date,
      amount_display: fmt(inv.amount_kopecks),
      paid_display: fmt(inv.paid_kopecks),
      remaining_display: fmt(inv.remaining_kopecks),
      payments: pmts.rows.map(p => ({
        amount_display: fmt(p.amount_kopecks), method: p.method, payment_date: p.payment_date,
      })),
    });
  } catch (e) {
    return dbErr(res, e, '[public invoice]');
  }
});

module.exports = router;
