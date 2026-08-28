const express = require('express');
const { pool } = require('../lib/db');
const { ok, dbErr } = require('../lib/http');
const { authMiddleware, requireRole } = require('../lib/auth');

const router = express.Router();

// Журнал аудита читают только owner и vendor_admin — ровно те роли, которым
// карта прав PERMISSIONS (routes/users.js) даёт 'audit:read'. Раньше роут был
// защищён только authMiddleware, и любой аутентифицированный участник
// организации (в т.ч. accountant и readonly) мог прочитать весь журнал: входы,
// email'ы, до/после реквизитов организации и банка, действия по приглашениям.
const canReadAudit = requireRole('owner', 'vendor_admin');

router.get('/logs', authMiddleware, canReadAudit, async (req, res) => {
  const orgId  = req.user.org_id;
  const action = req.query.action;
  const limit  = Math.min(100, parseInt(req.query.limit) || 30);

  try {
    const params = [orgId];
    let where = 'WHERE org_id = $1';
    if (action) { params.push(action); where += ` AND action = $${params.length}`; }

    const { rows } = await pool.query(
      `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT $${params.length + 1}`,
      [...params, limit]
    );
    return ok(res, { items: rows, total: rows.length });
  } catch (e) {
    return dbErr(res, e, '[audit]');
  }
});

module.exports = router;
