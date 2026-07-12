const express = require('express');
const { pool } = require('../lib/db');
const { ok, err, dbErr } = require('../lib/http');
const { authMiddleware } = require('../lib/auth');
const { audit } = require('../lib/audit');

const router = express.Router();

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, inn, kpp, plan, invoice_limit, created_at FROM organizations WHERE id = $1`,
      [req.user.org_id]
    );
    if (!rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[org get]');
  }
});

router.patch('/me', authMiddleware, async (req, res) => {
  if (req.user.role !== 'owner')
    return err(res, 403, 'Изменять данные организации может только владелец', 'FORBIDDEN');

  const { name, inn, kpp } = req.body || {};
  if (name !== undefined && !name.trim())
    return err(res, 400, 'Название не может быть пустым', 'VALIDATION_ERROR');
  if (inn !== undefined && inn && !/^\d{10}(\d{2})?$/.test(inn))
    return err(res, 400, 'ИНН должен содержать 10 или 12 цифр', 'VALIDATION_ERROR');
  if (kpp !== undefined && kpp && !/^\d{9}$/.test(kpp))
    return err(res, 400, 'КПП должен содержать 9 цифр', 'VALIDATION_ERROR');

  try {
    const existing = await pool.query('SELECT * FROM organizations WHERE id = $1', [req.user.org_id]);
    if (!existing.rows.length) return err(res, 404, 'Организация не найдена', 'NOT_FOUND');

    const { rows } = await pool.query(`
      UPDATE organizations SET
        name = COALESCE($1, name), inn = COALESCE($2, inn), kpp = COALESCE($3, kpp),
        updated_at = NOW()
      WHERE id = $4
      RETURNING id, name, inn, kpp, plan, invoice_limit, created_at
    `, [name?.trim() ?? null, inn ?? null, kpp ?? null, req.user.org_id]);

    await audit(req.user.org_id, req.user.id, 'organization.updated', 'organization', req.user.org_id, existing.rows[0], rows[0]);
    return ok(res, rows[0]);
  } catch (e) {
    return dbErr(res, e, '[org update]');
  }
});

module.exports = router;
