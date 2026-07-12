const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr, fmt } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const orgId = req.user.org_id;
  try {
    const { rows } = await pool.query(`
      SELECT c.*,
        COUNT(i.id) AS invoice_count,
        COALESCE(SUM(i.amount_kopecks - i.paid_kopecks)
          FILTER (WHERE i.status NOT IN ('PAID','ARCHIVED')), 0) AS debt_kopecks
      FROM counterparties c
      LEFT JOIN invoices i ON i.counterparty_id = c.id
      WHERE c.org_id = $1 AND c.is_active = true
      GROUP BY c.id ORDER BY c.name
    `, [orgId]);
    return ok(res, { items: rows.map(r => ({ ...r, debt_display: fmt(r.debt_kopecks) })) });
  } catch (e) {
    return dbErr(res, e, '[counterparties]');
  }
});

router.post('/', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type } = req.body || {};
  if (!name || !name.trim())
    return err(res, 400, 'Укажите название', 'VALIDATION_ERROR');

  try {
    const { rows } = await pool.query(`
      INSERT INTO counterparties(org_id, name, inn, kpp, phone, email, address, type)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
    `, [req.user.org_id, name.trim(), inn || null, kpp || null, phone || null,
        email || null, address || null, type || 'vendor']);

    await audit(req.user.org_id, req.user.id, 'counterparty.created', 'counterparty', rows[0].id, null, { name });
    return ok(res, rows[0], 201);
  } catch (e) {
    return dbErr(res, e, '[counterparty create]');
  }
});

router.patch('/:id', authMiddleware, async (req, res) => {
  const { name, inn, kpp, phone, email, address, type, is_active } = req.body || {};
  try {
    const existing = await pool.query('SELECT * FROM counterparties WHERE id=$1 AND org_id=$2', [req.params.id, req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Контрагент не найден', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE counterparties SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        phone = COALESCE($4, phone), email = COALESCE($5, email), address = COALESCE($6, address),
        type = COALESCE($7, type), is_active = COALESCE($8, is_active)
      WHERE id = $9 RETURNING *
    `, [name ?? null, inn ?? null, kpp ?? null, phone ?? null, email ?? null, address ?? null, type ?? null, is_active ?? null, req.params.id]);

    await audit(req.user.org_id, req.user.id, 'counterparty.updated', 'counterparty', req.params.id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[counterparty update]');
  }
});

module.exports = router;
