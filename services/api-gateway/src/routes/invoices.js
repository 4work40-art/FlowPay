const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const orgId  = req.user.org_id;
  const status = req.query.status;
  const from   = req.query.from; // YYYY-MM-DD, по invoice_date
  const to     = req.query.to;
  const page   = Math.max(1, parseInt(req.query.page) || 1);
  const limit  = Math.min(100, parseInt(req.query.limit) || 20);
  const offset = (page - 1) * limit;

  try {
    const params = [orgId];
    let where = 'WHERE i.org_id = $1';
    if (status) { params.push(status.toUpperCase()); where += ` AND i.status = $${params.length}`; }
    if (from)   { params.push(from); where += ` AND i.created_at >= $${params.length}`; }
    if (to)     { params.push(to);   where += ` AND i.created_at < ($${params.length}::date + INTERVAL '1 day')`; }

    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      ${where}
      ORDER BY i.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, [...params, limit, offset]);

    const cnt = await pool.query(`SELECT COUNT(*) FROM invoices i ${where}`, params);

    return ok(res, {
      items: rows.map(r => ({
        ...r,
        amount_display:    fmt(r.amount_kopecks),
        paid_display:      fmt(r.paid_kopecks),
        remaining_display: fmt(r.remaining_kopecks),
      })),
      total: +cnt.rows[0].count, page, limit,
    });
  } catch (e) {
    return dbErr(res, e, '[invoices list]');
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, c.name AS counterparty_name,
        (i.amount_kopecks - i.paid_kopecks) AS remaining_kopecks
      FROM invoices i
      LEFT JOIN counterparties c ON i.counterparty_id = c.id
      WHERE i.id = $1
    `, [req.params.id]);

    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');

    const pmts = await pool.query(
      'SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );

    const inv = rows[0];
    return ok(res, {
      ...inv,
      amount_display:    fmt(inv.amount_kopecks),
      paid_display:      fmt(inv.paid_kopecks),
      remaining_display: fmt(inv.remaining_kopecks),
      payments: pmts.rows.map(p => ({ ...p, amount_display: fmt(p.amount_kopecks) })),
    });
  } catch (e) {
    return dbErr(res, e, '[invoice get]');
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { amount_kopecks, number, counterparty_id, due_date, notes } = req.body || {};
  if (!amount_kopecks || amount_kopecks <= 0)
    return err(res, 400, 'Сумма должна быть больше нуля', 'VALIDATION_ERROR');
  if (!Number.isInteger(amount_kopecks))
    return err(res, 400, 'Сумма должна быть целым числом (в копейках)', 'VALIDATION_ERROR');

  try {
    const orgId = req.user.org_id;

    const orgRows = await pool.query('SELECT invoice_limit FROM organizations WHERE id=$1', [orgId]);
    const limit = orgRows.rows[0]?.invoice_limit;
    if (limit != null) {
      const cnt = await pool.query('SELECT COUNT(*) FROM invoices WHERE org_id=$1', [orgId]);
      if (+cnt.rows[0].count >= limit)
        return err(res, 403, `Достигнут лимит счетов на вашем тарифе (${limit}). Обновите тариф, чтобы продолжить.`, 'PLAN_LIMIT_REACHED');
    }

    if (counterparty_id) {
      const cp = await pool.query('SELECT id FROM counterparties WHERE id=$1 AND org_id=$2', [counterparty_id, orgId]);
      if (!cp.rows.length)
        return err(res, 400, 'Контрагент не найден в вашей организации', 'VALIDATION_ERROR');
    }

    let finalNumber = number || null;
    if (!finalNumber) {
      // Атомарно берём и увеличиваем счётчик организации, чтобы два
      // одновременных запроса без ручного номера не получили один и тот же.
      const seqRows = await pool.query(
        `UPDATE organizations SET next_invoice_seq = next_invoice_seq + 1 WHERE id=$1 RETURNING next_invoice_seq - 1 AS seq`,
        [orgId]
      );
      finalNumber = String(seqRows.rows[0].seq);
    }

    const { rows } = await pool.query(`
      INSERT INTO invoices(org_id, counterparty_id, number, amount_kopecks, due_date, notes, status, created_by)
      VALUES($1,$2,$3,$4,$5,$6,'CREATED',$7) RETURNING *
    `, [orgId, counterparty_id || null, finalNumber, amount_kopecks, due_date || null, notes || null, req.user.id]);

    await audit(orgId, req.user.id, 'invoice.created', 'invoice', rows[0].id, null, { amount_kopecks, status: 'CREATED' });
    return ok(res, { ...rows[0], amount_display: fmt(rows[0].amount_kopecks) }, 201);
  } catch (e) {
    return dbErr(res, e, '[invoice create]');
  }
});

const TRANSITIONS = {
  mark_for_control: { from: ['CREATED'],                                  to: 'UNDER_CONTROL'   },
  set_pending:      { from: ['UNDER_CONTROL'],                             to: 'PAYMENT_PENDING' },
  open_dispute:     { from: ['PAYMENT_PENDING','OVERDUE','PARTIALLY_PAID'],to: 'DISPUTED'        },
  archive:          { from: ['PAID'],                                      to: 'ARCHIVED'        },
  write_off:        { from: ['OVERDUE'],                                   to: 'WRITTEN_OFF'     },
  mark_overdue:     { from: ['PAYMENT_PENDING','UNDER_CONTROL'],           to: 'OVERDUE'         },
  resolve_dispute:  { from: ['DISPUTED'],                                  to: 'UNDER_CONTROL'   },
};

router.patch('/:id/state', authMiddleware, async (req, res) => {
  const { transition, reason } = req.body || {};
  try {
    const { rows } = await pool.query('SELECT * FROM invoices WHERE id = $1', [req.params.id]);
    if (!rows.length || rows[0].org_id !== req.user.org_id)
      return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    const inv = rows[0];

    const t = TRANSITIONS[transition];
    if (!t) return err(res, 400, `Неизвестный переход статуса: ${transition}`, 'INVOICE_STATE_INVALID');
    if (!t.from.includes(inv.status))
      return err(res, 400, `Переход «${transition}» недопустим из статуса ${inv.status}`, 'INVOICE_STATE_INVALID');

    await pool.query('UPDATE invoices SET status=$1, updated_at=NOW(), version=version+1 WHERE id=$2', [t.to, req.params.id]);
    await audit(inv.org_id, req.user.id, 'invoice.state_changed', 'invoice', req.params.id,
      { status: inv.status }, { status: t.to, reason });

    return ok(res, { id: req.params.id, previous_state: inv.status, new_state: t.to, transitioned_at: new Date().toISOString() });
  } catch (e) {
    return dbErr(res, e, '[invoice state]');
  }
});

// Включение/отключение публичной ссылки на счёт. Отключённая ссылка
// возвращает контрагенту 404 — доступ можно отозвать в любой момент.
router.patch('/:id/public', authMiddleware, async (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean')
    return err(res, 400, 'Укажите enabled: true|false', 'VALIDATION_ERROR');
  try {
    const { rows } = await pool.query(
      'UPDATE invoices SET public_enabled=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3 RETURNING id, public_enabled',
      [enabled, req.params.id, req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Счёт не найден', 'NOT_FOUND');
    await audit(req.user.org_id, req.user.id, 'invoice.public_toggled', 'invoice', req.params.id,
      null, { public_enabled: enabled });
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[invoice public toggle]');
  }
});

module.exports = router;
